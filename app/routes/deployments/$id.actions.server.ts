import { propagateVerificationToSiblings } from '~/db/application-groups.server'
import { createComment, deleteComment, deleteLegacyInfo, getLegacyInfo } from '~/db/comments.server'
import { addDeploymentGoalLink, removeDeploymentGoalLink } from '~/db/deployment-goal-links.server'
import {
  getDeploymentById,
  recordBaselineApproval,
  updateDeploymentFourEyes,
  updateDeploymentLegacyData,
} from '~/db/deployments.server'
import { createDeviation } from '~/db/deviations.server'
import { getDeviationSlackChannel } from '~/db/global-settings.server'
import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { getUserIdentity } from '~/lib/auth.server'
import { type DeploymentCapabilities, resolveDeploymentCapabilities } from '~/lib/authorization.server'
import { lookupLegacyByCommit, lookupLegacyByPR } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { notifyDeploymentIfNeeded, sendDeviationNotification } from '~/lib/slack/client.server'
import { runVerification } from '~/lib/verification'

const INTENT_CAPABILITY: Record<string, keyof DeploymentCapabilities> = {
  manual_approval: 'canApprove',
  confirm_legacy_lookup: 'canApprove',
  register_legacy_info: 'canApprove',
  approve_legacy: 'canApprove',
  reject_legacy: 'canApprove',
  approve_baseline: 'canApprove',
  verify_four_eyes: 'canVerify',
  register_deviation: 'canDeviate',
  delete_comment: 'canDeviate',
  link_goal: 'canLinkGoal',
  unlink_goal: 'canLinkGoal',
  send_slack_notification: 'canNotify',
  lookup_legacy_github: 'canLookupLegacy',
}

export async function action({ request, params }: { request: Request; params: Record<string, string | undefined> }) {
  const deploymentId = parseInt(params.id ?? '', 10)
  if (!Number.isFinite(deploymentId)) {
    throw new Response('Ugyldig deployment-ID', { status: 400 })
  }
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'add_comment') {
    const identity = await getUserIdentity(request)
    if (!identity) {
      return { error: 'Ikke autentisert' }
    }
    const commentText = formData.get('comment_text') as string
    const slackLink = formData.get('slack_link') as string

    if (!commentText || commentText.trim() === '') {
      return { error: 'Kommentar kan ikke være tom' }
    }

    try {
      await createComment({
        deployment_id: deploymentId,
        comment_text: commentText.trim(),
        slack_link: slackLink || undefined,
        registered_by: identity.navIdent,
      })
      return { success: 'Kommentar lagt til' }
    } catch (_error) {
      return { error: 'Kunne ikke legge til kommentar' }
    }
  }

  const identity = await getUserIdentity(request)
  if (!identity?.navIdent) {
    return { error: 'Kunne ikke identifisere bruker. Vennligst logg inn på nytt.' }
  }

  const deployment = await getDeploymentById(deploymentId)
  if (!deployment) {
    return { error: 'Deployment ikke funnet' }
  }

  const requiredCapability = typeof intent === 'string' ? INTENT_CAPABILITY[intent] : undefined
  if (!requiredCapability) {
    return { error: 'Ugyldig handling' }
  }
  const capabilities = await resolveDeploymentCapabilities(identity, deployment.monitored_app_id)
  if (!capabilities[requiredCapability]) {
    return { error: 'Du har ikke tilgang til å utføre denne handlingen' }
  }

  if (intent === 'verify_four_eyes') {
    if (!deployment.commit_sha) {
      return { error: 'Kan ikke verifisere: deployment mangler commit SHA' }
    }
    if (!deployment.detected_github_owner || !deployment.detected_github_repo_name) {
      return { error: 'Kan ikke verifisere: deployment mangler repository info' }
    }
    try {
      if (!deployment.default_branch) {
        return {
          error:
            'Kan ikke verifisere: default_branch er ikke satt. Vent på automatisk synkronisering eller sett branchen manuelt i app-admin.',
        }
      }
      logger.info(`🔍 Manually verifying deployment ${deployment.nais_deployment_id}...`)
      const result = await runVerification(deployment.id, {
        commitSha: deployment.commit_sha,
        repository: `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        environmentName: deployment.environment_name,
        baseBranch: deployment.default_branch,
        monitoredAppId: deployment.monitored_app_id,
        forceRefresh: true,
        triggerUrl: deployment.trigger_url,
      })
      if (result.status !== 'error') {
        return { success: 'Four-eyes status verifisert og oppdatert' }
      }
      return { error: 'Verifisering feilet - se logger for detaljer' }
    } catch (error) {
      logger.error('Verification error:', error)
      if (error instanceof Error && error.message.includes('rate limit')) {
        return { error: 'GitHub rate limit nådd. Prøv igjen senere.' }
      }
      return {
        error: `Kunne ikke verifisere: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
      }
    }
  }

  if (intent === 'manual_approval') {
    const reason = formData.get('reason') as string
    const slackLink = formData.get('slack_link') as string

    const usernamesToCheck: string[] = []
    if (deployment.github_pr_data?.creator?.username) {
      usernamesToCheck.push(deployment.github_pr_data.creator.username)
    }
    if (deployment.unverified_commits) {
      for (const commit of deployment.unverified_commits) {
        if (commit.author && !usernamesToCheck.includes(commit.author)) {
          usernamesToCheck.push(commit.author)
        }
      }
    }

    const userMappings = await getGithubUserLookups(usernamesToCheck)
    const currentNavIdent = identity.navIdent.toUpperCase()

    const prCreatorUsername = deployment.github_pr_data?.creator?.username
    if (prCreatorUsername) {
      const prCreatorMapping = userMappings.get(prCreatorUsername)
      if (prCreatorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        return {
          error:
            'Du kan ikke godkjenne din egen pull request. Fire-øyne-prinsippet krever at en annen person godkjenner.',
        }
      }
    }

    if (deployment.unverified_commits && deployment.unverified_commits.length > 0) {
      const lastCommit = deployment.unverified_commits[deployment.unverified_commits.length - 1]
      const lastCommitAuthorMapping = userMappings.get(lastCommit.author)
      if (lastCommitAuthorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        return {
          error:
            'Du kan ikke godkjenne en deployment der du har siste commit. Fire-øyne-prinsippet krever at en annen person godkjenner.',
        }
      }
    }

    try {
      await createComment({
        deployment_id: deploymentId,
        comment_text: reason || 'Manuelt godkjent etter gjennomgang',
        slack_link: slackLink?.trim() || undefined,
        comment_type: 'manual_approval',
        approved_by: identity.navIdent,
        registered_by: identity.navIdent,
      })

      await updateDeploymentFourEyes(
        deploymentId,
        {
          fourEyesStatus: 'manually_approved',
          githubPrNumber: deployment.github_pr_number ?? null,
          githubPrUrl: deployment.github_pr_url ?? null,
          githubPrData: deployment.github_pr_data ?? undefined,
          title: deployment.title ?? null,
          unverifiedCommits: deployment.unverified_commits ?? undefined,
        },
        { changeSource: 'manual_approval', changedBy: identity.navIdent },
      )

      if (deployment.commit_sha) {
        await propagateVerificationToSiblings(
          deploymentId,
          'manually_approved',
          deployment.commit_sha,
          deployment.monitored_app_id,
        )
      }

      return { success: 'Deployment manuelt godkjent' }
    } catch (_error) {
      return { error: 'Kunne ikke godkjenne deployment' }
    }
  }

  if (intent === 'register_deviation') {
    const reason = formData.get('deviation_reason') as string
    const breachType = formData.get('deviation_breach_type') as string
    const deviationIntent = formData.get('deviation_intent') as string
    const severity = formData.get('deviation_severity') as string
    const followUpRole = formData.get('deviation_follow_up_role') as string

    if (!reason || reason.trim() === '') {
      return { error: 'Beskrivelse av avvik er påkrevd' }
    }

    try {
      const app = await getMonitoredApplicationById(deployment.monitored_app_id)

      await createDeviation({
        deployment_id: deploymentId,
        reason: reason.trim(),
        breach_type: breachType?.trim() || undefined,
        intent: (deviationIntent as 'malicious' | 'accidental' | 'unknown') || undefined,
        severity: (severity as 'low' | 'medium' | 'high' | 'critical') || undefined,
        follow_up_role: (followUpRole as 'product_lead' | 'delivery_lead' | 'section_lead') || undefined,
        registered_by: identity.navIdent,
        registered_by_name: identity.name,
      })

      const deviationChannelConfig = await getDeviationSlackChannel()
      if (deviationChannelConfig.channel_id) {
        const appUrl = app ? `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}` : ''
        const baseUrl = process.env.BASE_URL || 'https://nda.ansatt.nav.no'
        await sendDeviationNotification(
          {
            deploymentId,
            appName: app?.app_name || 'Ukjent',
            environmentName: app?.environment_name || 'Ukjent',
            teamSlug: app?.team_slug || 'Ukjent',
            commitSha: deployment.commit_sha || 'Ukjent',
            reason: reason.trim(),
            breachType: breachType?.trim() || undefined,
            intent: deviationIntent || undefined,
            severity: severity || undefined,
            followUpRole: followUpRole || undefined,
            registeredByName: identity.name || identity.navIdent,
            detailsUrl: `${baseUrl}${appUrl}/deployments/${deploymentId}`,
          },
          deviationChannelConfig.channel_id,
        )
      }

      return { success: 'Avvik registrert' }
    } catch (_error) {
      return { error: 'Kunne ikke registrere avvik' }
    }
  }

  if (intent === 'lookup_legacy_github') {
    const searchType = formData.get('search_type') as string
    const searchValue = formData.get('search_value') as string
    const slackLink = formData.get('slack_link') as string

    if (!slackLink || slackLink.trim() === '') {
      return { error: 'Slack-lenke er påkrevd' }
    }

    if (!searchValue || searchValue.trim() === '') {
      return { error: searchType === 'sha' ? 'Commit SHA må oppgis' : 'PR-nummer må oppgis' }
    }

    const owner = deployment.detected_github_owner
    const repo = deployment.detected_github_repo_name

    if (!owner || !repo) {
      return { error: 'Repository info mangler på deployment' }
    }

    try {
      const result =
        searchType === 'pr'
          ? await lookupLegacyByPR(owner, repo, parseInt(searchValue.trim(), 10), deployment.created_at)
          : await lookupLegacyByCommit(owner, repo, searchValue.trim(), deployment.created_at)

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

  if (intent === 'confirm_legacy_lookup') {
    const slackLink = formData.get('slack_link') as string
    const commitSha = formData.get('commit_sha') as string
    const commitMessage = formData.get('commit_message') as string
    const commitAuthor = formData.get('commit_author') as string
    const prNumber = formData.get('pr_number') as string
    const prTitle = formData.get('pr_title') as string
    const prUrl = formData.get('pr_url') as string
    const prAuthor = formData.get('pr_author') as string
    const prMergedAt = formData.get('pr_merged_at') as string
    const mergedBy = formData.get('merged_by') as string
    const reviewersJson = formData.get('reviewers') as string

    try {
      const reviewers = reviewersJson ? JSON.parse(reviewersJson) : []

      const effectiveDeployer = mergedBy || commitAuthor
      const parts: string[] = []
      if (effectiveDeployer) parts.push(`Deployer: ${effectiveDeployer}`)
      if (commitSha) parts.push(`SHA: ${commitSha.substring(0, 7)}`)
      if (prNumber) parts.push(`PR: #${prNumber}`)
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
        prNumber: prNumber ? parseInt(prNumber, 10) : null,
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
          githubPrNumber: updatedDeployment?.github_pr_number || (prNumber ? parseInt(prNumber, 10) : null),
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

  if (intent === 'register_legacy_info') {
    const slackLink = formData.get('slack_link') as string
    const deployer = formData.get('deployer') as string
    const commitSha = formData.get('commit_sha') as string
    const prNumber = formData.get('pr_number') as string

    if (!slackLink || slackLink.trim() === '') {
      return { error: 'Slack-lenke er påkrevd' }
    }

    try {
      const parts: string[] = []
      if (deployer) parts.push(`Deployer: ${deployer.trim()}`)
      if (commitSha) parts.push(`SHA: ${commitSha.trim()}`)
      if (prNumber) parts.push(`PR: #${prNumber.trim()}`)
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
          githubPrNumber: prNumber ? parseInt(prNumber, 10) : null,
          githubPrUrl: null,
        },
        { changeSource: 'legacy', changedBy: identity.navIdent },
      )

      return { success: 'Legacy info registrert - venter på godkjenning fra annen person' }
    } catch (_error) {
      return { error: 'Kunne ikke registrere legacy info' }
    }
  }

  if (intent === 'approve_legacy') {
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

  if (intent === 'reject_legacy') {
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

  if (intent === 'delete_comment') {
    const commentId = parseInt(formData.get('comment_id') as string, 10)
    try {
      const deleted = await deleteComment(commentId, identity.navIdent, deploymentId)
      if (!deleted) {
        return { error: 'Kommentaren ble ikke funnet eller er allerede slettet' }
      }
      return { success: 'Kommentar slettet' }
    } catch (_error) {
      return { error: 'Kunne ikke slette kommentar' }
    }
  }

  if (intent === 'approve_baseline') {
    try {
      if (deployment.four_eyes_status === 'baseline') {
        await recordBaselineApproval(deploymentId, identity.navIdent)
      } else {
        await updateDeploymentFourEyes(
          deploymentId,
          {
            fourEyesStatus: 'baseline',
            githubPrNumber: null,
            githubPrUrl: null,
          },
          { changeSource: 'baseline_approval', changedBy: identity.navIdent },
        )
      }
      return { success: 'Deployment godkjent som baseline' }
    } catch (_error) {
      return { error: 'Kunne ikke godkjenne baseline' }
    }
  }

  if (intent === 'send_slack_notification') {
    const app = await getMonitoredApplicationById(deployment.monitored_app_id)
    if (!app) {
      return { error: 'App ikke funnet' }
    }

    if (!app.slack_notifications_enabled || !app.slack_channel_id) {
      return { error: 'Slack-varsler er ikke konfigurert for denne appen' }
    }

    if (deployment.slack_message_ts) {
      return { error: 'Slack-varsel er allerede sendt for denne deploymenten' }
    }

    try {
      const baseUrl = new URL(request.url).origin

      const sent = await notifyDeploymentIfNeeded(
        {
          ...deployment,
          app_slack_channel_id: app.slack_channel_id,
          slack_notifications_enabled: app.slack_notifications_enabled,
        },
        baseUrl,
      )

      if (sent) {
        return { success: 'Slack-varsel sendt!' }
      }
      return { error: 'Kunne ikke sende Slack-varsel. Sjekk at Slack er konfigurert.' }
    } catch (error) {
      logger.error('Slack notification error:', error)
      return { error: 'Feil ved sending av Slack-varsel' }
    }
  }

  if (intent === 'link_goal') {
    const objectiveId = formData.get('objective_id') ? Number(formData.get('objective_id')) : undefined
    const keyResultId = formData.get('key_result_id') ? Number(formData.get('key_result_id')) : undefined
    const externalUrl = (formData.get('external_url') as string)?.trim() || undefined
    const externalUrlTitle = (formData.get('external_url_title') as string)?.trim() || undefined
    const comment = (formData.get('comment') as string)?.trim() || undefined

    if (!objectiveId && !keyResultId) {
      return { error: 'Velg et mål eller nøkkelresultat.' }
    }

    try {
      const link = await addDeploymentGoalLink({
        deployment_id: deploymentId,
        objective_id: objectiveId,
        key_result_id: keyResultId,
        external_url: externalUrl,
        external_url_title: externalUrlTitle,
        comment,
        link_method: 'manual',
        linked_by: identity.navIdent,
      })
      if (!link) return { error: 'Koblingen finnes allerede.' }
      return { success: 'Kobling lagt til' }
    } catch (error) {
      logger.error('Error linking goal:', error)
      return { error: 'Kunne ikke legge til kobling' }
    }
  }

  if (intent === 'unlink_goal') {
    const linkId = Number(formData.get('link_id'))
    try {
      const removed = await removeDeploymentGoalLink(linkId, deploymentId)
      if (!removed) {
        return { error: 'Koblingen ble ikke funnet eller er allerede fjernet' }
      }
      return { success: 'Kobling fjernet' }
    } catch (error) {
      logger.error('Error removing goal link:', error)
      return { error: 'Kunne ikke fjerne kobling' }
    }
  }

  return null
}
