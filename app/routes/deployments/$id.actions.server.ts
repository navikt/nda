import { propagateVerificationToSiblings } from '~/db/application-groups.server'
import { createComment, deleteComment } from '~/db/comments.server'
import { addDeploymentGoalLink, removeDeploymentGoalLink } from '~/db/deployment-goal-links.server'
import { resetVerificationStatus } from '~/db/deployments/status-history.server'
import {
  getDeploymentById,
  moveBaselineToDeployment,
  recordBaselineApproval,
  updateDeploymentFourEyes,
} from '~/db/deployments.server'
import { createDeviation } from '~/db/deviations.server'
import { getDeviationSlackChannel } from '~/db/global-settings.server'
import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { getUserIdentity } from '~/lib/auth.server'
import { type DeploymentCapabilities, resolveDeploymentCapabilities } from '~/lib/authorization.server'
import { getFormString } from '~/lib/form-validators'
import { isProtectedStatus } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { notifyDeploymentIfNeeded, sendDeviationNotification } from '~/lib/slack/client.server'
import { runVerification } from '~/lib/verification'
import {
  type ActionResult,
  handleApproveLegacy,
  handleConfirmLegacyLookup,
  handleLookupLegacyGithub,
  handleRegisterLegacyInfo,
  handleRejectLegacy,
} from './$id.actions.legacy.server'

const INTENT_CAPABILITY: Record<string, keyof DeploymentCapabilities> = {
  manual_approval: 'canApprove',
  confirm_legacy_lookup: 'canApprove',
  register_legacy_info: 'canApprove',
  approve_legacy: 'canApprove',
  reject_legacy: 'canApprove',
  approve_baseline: 'canApprove',
  move_baseline: 'canMoveBaseline',
  verify_four_eyes: 'canVerify',
  register_deviation: 'canDeviate',
  delete_comment: 'canDeviate',
  link_goal: 'canLinkGoal',
  unlink_goal: 'canLinkGoal',
  send_slack_notification: 'canNotify',
  lookup_legacy_github: 'canLookupLegacy',
  reset_verification: 'canResetVerification',
}

const MOVE_BASELINE_ERROR_MESSAGES = {
  not_found: 'Deployment ikke funnet',
  already_baseline: 'Deploymenten er allerede baseline',
  legacy_status: 'Legacy-deployments kan ikke settes som baseline',
  invalid_commit_sha: 'Deploymenten mangler gyldig commit-SHA og kan ikke brukes som baseline',
  outside_audit_window: 'Deploymenten ligger før revisjonsperioden og kan ikke brukes som baseline',
  no_later_anchor: 'Fant ingen senere baseline eller foreslått baseline å flytte bakover',
} as const

export async function action({
  request,
  params,
  url,
}: {
  request: Request
  params: Record<string, string | undefined>
  url: URL
}): Promise<ActionResult | null> {
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
    return await handleLookupLegacyGithub(deploymentId, deployment, identity, formData)
  }

  if (intent === 'confirm_legacy_lookup') {
    return await handleConfirmLegacyLookup(deploymentId, deployment, identity, formData)
  }

  if (intent === 'register_legacy_info') {
    return await handleRegisterLegacyInfo(deploymentId, deployment, identity, formData)
  }

  if (intent === 'approve_legacy') {
    return await handleApproveLegacy(deploymentId, deployment, identity, formData)
  }

  if (intent === 'reject_legacy') {
    return await handleRejectLegacy(deploymentId, deployment, identity, formData)
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

  if (intent === 'move_baseline') {
    const reason = getFormString(formData, 'reason')
    if (!reason) {
      return { error: 'Begrunnelse er påkrevd for å flytte baseline' }
    }
    try {
      const result = await moveBaselineToDeployment(deploymentId, identity.navIdent, reason)
      if (!result.moved) {
        return { error: MOVE_BASELINE_ERROR_MESSAGES[result.reason] }
      }
      const suffix = result.demotedCount === 1 ? '' : 'er'
      return {
        success: `Baseline flyttet hit. ${result.demotedCount} senere deployment${suffix} er nedgradert og re-verifiseres automatisk.`,
      }
    } catch (error) {
      logger.error('Error moving baseline', error)
      return { error: 'Kunne ikke flytte baseline' }
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
      const baseUrl = url.origin

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

  if (intent === 'reset_verification') {
    const reason = getFormString(formData, 'reason')
    if (!reason) {
      return { error: 'Begrunnelse er påkrevd for å tilbakestille verifisering' }
    }
    const currentStatus = deployment.four_eyes_status
    if (!currentStatus) {
      return { error: 'Deployment har ingen status å tilbakestille' }
    }
    if (!isProtectedStatus(currentStatus)) {
      return { error: 'Kun deployments med beskyttet status kan tilbakestilles' }
    }
    try {
      await resetVerificationStatus(deploymentId, identity.navIdent, reason, currentStatus)
      return { success: 'Verifisering tilbakestilt — deploymenten kan nå re-verifiseres' }
    } catch (error) {
      logger.error('Error resetting verification status', error)
      return { error: 'Kunne ikke tilbakestille verifisering' }
    }
  }

  return null
}
