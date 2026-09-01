import { createComment, deleteLegacyInfo, getLegacyInfo } from '~/db/comments.server'
import {
  type DeploymentWithApp,
  getDeploymentById,
  updateDeploymentFourEyes,
  updateDeploymentLegacyData,
} from '~/db/deployments.server'
import { propagateVerificationToSiblings } from '~/db/monorepo.server'
import type { UserIdentity } from '~/lib/auth.server'
import { type LegacyLookupResult, lookupLegacyByCommit, lookupLegacyByPR } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { runVerification } from '~/lib/verification'

export function parsePrNumber(raw: FormDataEntryValue | null | undefined): { value: number | null; error?: string } {
  if (raw === null || raw === undefined) {
    return { value: null }
  }
  if (typeof raw !== 'string') {
    return { value: null, error: 'PR-nummer må være et positivt heltall' }
  }
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { value: null }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: 'PR-nummer må være et positivt heltall' }
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { value: null, error: 'PR-nummer må være et positivt heltall' }
  }
  return { value: parsed }
}

export interface ActionResult {
  error?: string
  success?: string
  legacyLookup?: {
    slackLink: string
    registeredBy: string
    commitSha: string
    commitMessage: string
    commitDate: Date
    commitAuthor: string
    prNumber?: number
    prTitle?: string
    prUrl?: string
    prMergedAt?: Date
    prAuthor?: string
    mergedBy?: string
    reviewers?: Array<{ username: string; state: string }>
    timeDifferenceMinutes: number
    isWithinThreshold: boolean
  }
}

export async function handleLookupLegacyGithub(
  _deploymentId: number,
  deployment: DeploymentWithApp,
  identity: UserIdentity,
  formData: FormData,
): Promise<ActionResult> {
  const searchType = formData.get('search_type') as string
  const rawSearchValue = formData.get('search_value')
  const searchValue = typeof rawSearchValue === 'string' ? rawSearchValue : ''
  const slackLink = formData.get('slack_link') as string

  if (!slackLink || slackLink.trim() === '') {
    return { error: 'Slack-lenke er påkrevd' }
  }

  if (typeof rawSearchValue !== 'string' || searchValue.trim() === '') {
    return { error: searchType === 'sha' ? 'Commit SHA må oppgis' : 'PR-nummer må oppgis' }
  }

  const owner = deployment.detected_github_owner
  const repo = deployment.detected_github_repo_name

  if (!owner || !repo) {
    return { error: 'Repository info mangler på deployment' }
  }

  try {
    let result: LegacyLookupResult
    if (searchType === 'pr') {
      const parsed = parsePrNumber(formData.get('search_value'))
      if (parsed.error || parsed.value === null) {
        return { error: parsed.error || 'PR-nummer må oppgis' }
      }
      result = await lookupLegacyByPR(owner, repo, parsed.value, deployment.created_at)
    } else {
      result = await lookupLegacyByCommit(owner, repo, searchValue.trim(), deployment.created_at)
    }

    if (!result.success || !result.data) {
      return { error: result.error || 'Kunne ikke finne data på GitHub' }
    }

    return {
      legacyLookup: {
        ...result.data,
        slackLink: slackLink.trim(),
        registeredBy: identity.navIdent,
      },
    }
  } catch (error) {
    logger.error('Legacy lookup error:', error)
    return { error: `Feil ved oppslag: ${error instanceof Error ? error.message : 'Ukjent feil'}` }
  }
}

export async function handleConfirmLegacyLookup(
  deploymentId: number,
  _deployment: DeploymentWithApp,
  identity: UserIdentity,
  formData: FormData,
): Promise<ActionResult> {
  const slackLink = formData.get('slack_link') as string
  const commitSha = formData.get('commit_sha') as string
  const commitMessage = formData.get('commit_message') as string
  const commitAuthor = formData.get('commit_author') as string
  const prTitle = formData.get('pr_title') as string
  const prUrl = formData.get('pr_url') as string
  const prAuthor = formData.get('pr_author') as string
  const prMergedAt = formData.get('pr_merged_at') as string
  const mergedBy = formData.get('merged_by') as string
  const reviewersJson = formData.get('reviewers') as string

  const parsedPrNumber = parsePrNumber(formData.get('pr_number'))
  if (parsedPrNumber.error) {
    return { error: parsedPrNumber.error }
  }

  try {
    const reviewers = reviewersJson ? JSON.parse(reviewersJson) : []

    const effectiveDeployer = mergedBy || commitAuthor
    const parts: string[] = []
    if (effectiveDeployer) parts.push(`Deployer: ${effectiveDeployer}`)
    if (commitSha) parts.push(`SHA: ${commitSha.substring(0, 7)}`)
    if (parsedPrNumber.value) parts.push(`PR: #${parsedPrNumber.value}`)
    const infoText = parts.length > 0 ? `GitHub-verifisert: ${parts.join(', ')}` : 'Legacy info fra GitHub'

    await createComment({
      deployment_id: deploymentId,
      comment_text: infoText,
      slack_link: slackLink,
      comment_type: 'legacy_info',
      registered_by: identity.navIdent,
    })

    await updateDeploymentLegacyData(deploymentId, {
      commitSha: commitSha || null,
      commitMessage: commitMessage || null,
      deployer: commitAuthor || null,
      mergedBy: mergedBy || null,
      prNumber: parsedPrNumber.value,
      prUrl: prUrl || null,
      prTitle: prTitle || null,
      prAuthor: prAuthor || null,
      prMergedAt: prMergedAt || null,
      reviewers,
    })

    let updatedDeployment = await getDeploymentById(deploymentId)
    if (updatedDeployment && commitSha && updatedDeployment.default_branch) {
      logger.info(`🔄 Running full GitHub verification for legacy deployment ${deploymentId}`)
      const repository = `${updatedDeployment.detected_github_owner}/${updatedDeployment.detected_github_repo_name}`
      await runVerification(deploymentId, {
        commitSha,
        repository,
        environmentName: updatedDeployment.environment_name,
        baseBranch: updatedDeployment.default_branch,
        monitoredAppId: updatedDeployment.monitored_app_id,
        forceRefresh: true,
      })

      updatedDeployment = await getDeploymentById(deploymentId)
    }

    await updateDeploymentFourEyes(
      deploymentId,
      {
        fourEyesStatus: 'legacy_pending',
        githubPrNumber: updatedDeployment?.github_pr_number || parsedPrNumber.value,
        githubPrUrl: updatedDeployment?.github_pr_url || prUrl || null,
        githubPrData: updatedDeployment?.github_pr_data || undefined,
        title: updatedDeployment?.title || prTitle || commitMessage || null,
      },
      { changeSource: 'legacy', changedBy: identity.navIdent },
    )

    return { success: 'GitHub-data lagret - venter på godkjenning fra annen person' }
  } catch (error) {
    logger.error('Error saving legacy data:', error)
    return { error: 'Kunne ikke lagre data' }
  }
}

export async function handleRegisterLegacyInfo(
  deploymentId: number,
  _deployment: DeploymentWithApp,
  identity: UserIdentity,
  formData: FormData,
): Promise<ActionResult> {
  const slackLink = formData.get('slack_link') as string
  const deployer = formData.get('deployer') as string
  const commitSha = formData.get('commit_sha') as string

  if (!slackLink || slackLink.trim() === '') {
    return { error: 'Slack-lenke er påkrevd' }
  }

  const parsedPrNumber = parsePrNumber(formData.get('pr_number'))
  if (parsedPrNumber.error) {
    return { error: parsedPrNumber.error }
  }

  try {
    const parts: string[] = []
    if (deployer) parts.push(`Deployer: ${deployer.trim()}`)
    if (commitSha) parts.push(`SHA: ${commitSha.trim()}`)
    if (parsedPrNumber.value) parts.push(`PR: #${parsedPrNumber.value}`)
    const infoText = parts.length > 0 ? parts.join(', ') : 'Legacy info registrert'

    await createComment({
      deployment_id: deploymentId,
      comment_text: infoText,
      slack_link: slackLink.trim(),
      comment_type: 'legacy_info',
      registered_by: identity.navIdent,
    })

    await updateDeploymentFourEyes(
      deploymentId,
      {
        fourEyesStatus: 'pending_approval',
        githubPrNumber: parsedPrNumber.value,
        githubPrUrl: null,
      },
      { changeSource: 'legacy', changedBy: identity.navIdent },
    )

    return { success: 'Legacy info registrert - venter på godkjenning fra annen person' }
  } catch (_error) {
    return { error: 'Kunne ikke registrere legacy info' }
  }
}

export async function handleApproveLegacy(
  deploymentId: number,
  _deployment: DeploymentWithApp,
  identity: UserIdentity,
  _formData: FormData,
): Promise<ActionResult> {
  const legacyInfo = await getLegacyInfo(deploymentId)

  if (!legacyInfo) {
    return { error: 'Ingen legacy info å godkjenne' }
  }

  if (legacyInfo.registered_by?.toLowerCase() === identity.navIdent.toLowerCase()) {
    return { error: 'Godkjenner kan ikke være samme person som registrerte info' }
  }

  try {
    const currentDeployment = await getDeploymentById(deploymentId)

    await createComment({
      deployment_id: deploymentId,
      comment_text: 'Legacy deployment godkjent etter gjennomgang',
      slack_link: legacyInfo.slack_link || undefined,
      comment_type: 'manual_approval',
      approved_by: identity.navIdent,
      registered_by: identity.navIdent,
    })

    await updateDeploymentFourEyes(
      deploymentId,
      {
        fourEyesStatus: 'manually_approved',
        githubPrNumber: currentDeployment?.github_pr_number || null,
        githubPrUrl: currentDeployment?.github_pr_url || null,
        githubPrData: currentDeployment?.github_pr_data || undefined,
        title: currentDeployment?.title || null,
      },
      { changeSource: 'legacy', changedBy: identity.navIdent },
    )

    if (currentDeployment?.commit_sha) {
      await propagateVerificationToSiblings(
        deploymentId,
        'manually_approved',
        currentDeployment.commit_sha,
        currentDeployment.monitored_app_id,
      )
    }

    return { success: 'Legacy deployment godkjent' }
  } catch (_error) {
    return { error: 'Kunne ikke godkjenne legacy deployment' }
  }
}

export async function handleRejectLegacy(
  deploymentId: number,
  _deployment: DeploymentWithApp,
  identity: UserIdentity,
  formData: FormData,
): Promise<ActionResult> {
  const reason = formData.get('reason') as string

  try {
    await deleteLegacyInfo(deploymentId, identity.navIdent)

    await createComment({
      deployment_id: deploymentId,
      comment_text: `Legacy-verifisering avvist av ${identity.navIdent}${reason ? `: ${reason}` : ''}`,
      comment_type: 'comment',
      registered_by: identity.navIdent,
    })

    await updateDeploymentFourEyes(
      deploymentId,
      {
        fourEyesStatus: 'legacy',
        githubPrNumber: null,
        githubPrUrl: null,
      },
      { changeSource: 'legacy', changedBy: identity.navIdent },
    )

    return { success: 'Legacy-verifisering avvist - kan registreres på nytt' }
  } catch (_error) {
    return { error: 'Kunne ikke avvise verifisering' }
  }
}
