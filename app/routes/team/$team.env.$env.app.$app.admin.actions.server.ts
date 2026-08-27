import { recordAppConfigAuditLog, updateImplicitApprovalSettings } from '~/db/app-settings.server'
import {
  archiveAuditReport,
  checkAuditReadiness,
  hasActiveReportForPeriod,
  restoreAuditReport,
} from '~/db/audit-reports.server'
import { withTransaction } from '~/db/connection.server'
import {
  getMonitoredApplicationById,
  getMonitoredApplicationByIdentity,
  updateMonitoredApplication,
} from '~/db/monitored-applications.server'
import { createReportJob, isStaleJob } from '~/db/report-jobs.server'
import type { SyncJob } from '~/db/sync-job-types'
import {
  acquireSyncLock,
  cancelSyncJob,
  forceReleaseSyncJob,
  getLatestSyncJob,
  getSyncJobById,
  getSyncJobOptions,
  heartbeatSyncJob,
  releaseSyncLock,
  SYNC_INTERVAL_MS,
  updateSyncJobProgress,
} from '~/db/sync-jobs.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { requireUser } from '~/lib/auth.server'
import { canAccessAppAdmin } from '~/lib/authorization.server'
import { endOfDay, parseLocalDate } from '~/lib/date-utils'
import { getFormString, isValidSlackChannel } from '~/lib/form-validators'
import { logger, runWithJobContext } from '~/lib/logger.server'
import { processReportJobAsync } from '~/lib/report-job-processor.server'
import { isValidReportPeriodType } from '~/lib/report-periods'
import type { SlackConfigSettingKey } from '~/lib/slack/config-setting-keys'
import { serializeUserLookups } from '~/lib/user-display'
import { fetchVerificationDataForAllDeployments } from '~/lib/verification'
import { computeVerificationDiffs } from '~/lib/verification/compute-diffs.server'
import { isImplicitApprovalMode } from '~/lib/verification/types'

class AppNotFoundError extends Error {}

async function updateSlackSettingWithAudit(params: {
  appId: number
  settingKey: SlackConfigSettingKey
  enabledField: 'slack_notifications_enabled' | 'slack_deploy_notify_enabled'
  channelField: 'slack_channel_id' | 'slack_deploy_channel_id'
  channelId: string | null
  enabled: boolean
  changedByNavIdent: string
  changedByName?: string
}): Promise<{ error?: string }> {
  const { appId, settingKey, enabledField, channelField, channelId, enabled, changedByNavIdent, changedByName } = params

  try {
    await withTransaction(async (client) => {
      const currentApp = await getMonitoredApplicationById(appId, client)
      if (!currentApp) {
        throw new AppNotFoundError()
      }

      await updateMonitoredApplication(appId, { [channelField]: channelId, [enabledField]: enabled }, client)

      if (currentApp[enabledField] !== enabled || currentApp[channelField] !== channelId) {
        await recordAppConfigAuditLog(
          {
            monitoredAppId: appId,
            settingKey,
            oldValue: { enabled: currentApp[enabledField], channel_id: currentApp[channelField] },
            newValue: { enabled, channel_id: channelId },
            changedByNavIdent,
            changedByName,
          },
          client,
        )
      }
    })
  } catch (err) {
    if (err instanceof AppNotFoundError) {
      return { error: 'Fant ikke applikasjonen' }
    }
    throw err
  }

  return {}
}

async function processFetchDataJobAsync(jobId: number, appId: number) {
  const options = await getSyncJobOptions(jobId)
  const debug = options?.debug === true
  const refreshDisplayData = options?.refreshDisplayData === true

  await runWithJobContext(jobId, 'fetch_verification_data', appId, debug, async () => {
    try {
      const result = await fetchVerificationDataForAllDeployments(appId, { jobId, refreshDisplayData })
      const job = await getSyncJobById(jobId)
      if (job?.status === 'cancelled') {
        return
      }
      await releaseSyncLock(jobId, 'completed', result as unknown as Record<string, unknown>)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      const job = await getSyncJobById(jobId)
      if (job?.status !== 'cancelled') {
        await releaseSyncLock(jobId, 'failed', undefined, errorMessage)
      }
      throw err
    }
  })
}

async function processComputeDiffsJobAsync(jobId: number, appId: number) {
  await runWithJobContext(jobId, 'reverify_app', appId, false, async () => {
    try {
      const result = await computeVerificationDiffs(appId, {
        jobId,
        onProgress: async (processed, total, diffsFound) => {
          await updateSyncJobProgress(jobId, { processed, total, diffsFound })
          if (processed % 10 === 0) {
            await heartbeatSyncJob(jobId)
          }
        },
      })
      const job = await getSyncJobById(jobId)
      if (job?.status === 'cancelled') return
      await releaseSyncLock(jobId, 'completed', result as unknown as Record<string, unknown>)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      const job = await getSyncJobById(jobId)
      if (job?.status !== 'cancelled') {
        await releaseSyncLock(jobId, 'failed', undefined, errorMessage)
      }
      throw err
    }
  })
}

const JOB_ID_ACTIONS = new Set([
  'check_fetch_job_status',
  'cancel_fetch_job',
  'force_release_job',
  'check_compute_diffs_status',
])

export async function action({ request }: { request: Request; params: Record<string, string | undefined> }) {
  const user = await requireUser(request)

  const formData = await request.formData()
  const action = formData.get('action') as string
  const appId = parseInt(formData.get('app_id') as string, 10)

  let authorizedJob: SyncJob | null = null

  if (JOB_ID_ACTIONS.has(action)) {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!Number.isFinite(jobId)) {
      return { error: 'Mangler eller ugyldig job_id' }
    }
    const job = await getSyncJobById(jobId)
    if (!job || job.monitored_app_id == null || !(await canAccessAppAdmin(user, job.monitored_app_id))) {
      return { error: 'Du har ikke tilgang til denne jobben' }
    }
    authorizedJob = job
  } else if (action === 'send_reminder') {
    const teamSlug = getFormString(formData, 'team_slug')
    const environmentName = getFormString(formData, 'environment_name')
    const appName = getFormString(formData, 'app_name')
    if (!teamSlug || !environmentName || !appName) {
      return { error: 'Mangler team_slug, environment_name eller app_name' }
    }
    const reminderApp = await getMonitoredApplicationByIdentity(teamSlug, environmentName, appName)
    if (!reminderApp || !(await canAccessAppAdmin(user, reminderApp.id))) {
      return { error: 'Du har ikke tilgang til å administrere denne applikasjonen' }
    }
  } else if (Number.isFinite(appId)) {
    if (!(await canAccessAppAdmin(user, appId))) {
      return { error: 'Du har ikke tilgang til å administrere denne applikasjonen' }
    }
  } else {
    return { error: 'Ugyldig eller manglende app-ID' }
  }

  if (action === 'update_default_branch') {
    const defaultBranch = formData.get('default_branch') as string
    if (!defaultBranch || defaultBranch.trim() === '') {
      return { error: 'Default branch kan ikke være tom' }
    }
    await updateMonitoredApplication(appId, { default_branch: defaultBranch.trim() })
    return { success: 'Default branch oppdatert!' }
  }

  if (action === 'update_implicit_approval') {
    const modeValue = formData.get('mode')
    if (typeof modeValue !== 'string' || !isImplicitApprovalMode(modeValue)) {
      return { error: 'Ugyldig modus' }
    }

    await updateImplicitApprovalSettings({
      monitoredAppId: appId,
      settings: { mode: modeValue },
      changedByNavIdent: user.navIdent,
      changedByName: user.name || undefined,
    })
    return { success: 'Implisitt godkjenning-innstillinger oppdatert!' }
  }

  if (action === 'update_test_requirement') {
    const testRequirement = formData.get('test_requirement') as 'none' | 'unit_tests' | 'integration_tests'
    if (!['none', 'unit_tests', 'integration_tests'].includes(testRequirement)) {
      return { error: 'Ugyldig testkrav' }
    }

    await updateMonitoredApplication(appId, { test_requirement: testRequirement })
    return { success: 'Testkrav oppdatert!' }
  }

  if (action === 'update_audit_start_year') {
    const appIdForYear = parseInt(formData.get('app_id') as string, 10)
    const startYearValue = formData.get('audit_start_year') as string

    let auditStartYear: number | null = null
    if (startYearValue && startYearValue.trim() !== '') {
      auditStartYear = parseInt(startYearValue, 10)
      if (Number.isNaN(auditStartYear) || auditStartYear < 2000 || auditStartYear > 2100) {
        return { error: 'Ugyldig startår. Må være mellom 2000 og 2100.' }
      }
    }

    await updateMonitoredApplication(appIdForYear, { audit_start_year: auditStartYear })
    return { success: 'Startår for revisjon oppdatert!' }
  }

  if (action === 'check_readiness') {
    const periodStart = formData.get('period_start') as string
    const periodEnd = formData.get('period_end') as string
    const periodTypeRaw = formData.get('period_type') as string
    if (!appId || !periodStart || !periodEnd) {
      return { error: 'Mangler app eller periode' }
    }
    if (!periodTypeRaw || !isValidReportPeriodType(periodTypeRaw)) {
      return { error: 'Ugyldig periodetype' }
    }

    let parsedStart: Date
    let readinessEnd: Date
    try {
      parsedStart = parseLocalDate(periodStart)
      readinessEnd = endOfDay(parseLocalDate(periodEnd))
    } catch {
      return { error: 'Ugyldig datoformat for periode (forventet YYYY-MM-DD)' }
    }
    const readiness = await checkAuditReadiness(appId, parsedStart, readinessEnd)

    const deployerUsernames = [
      ...readiness.pending_deployments.map((d) => d.deployer_username),
      ...readiness.missing_approver_deployments.map((d) => d.deployer_username),
    ].filter((u): u is string => u != null)
    const uniqueDeployers = [...new Set(deployerUsernames)]
    const userMappings = uniqueDeployers.length > 0 ? await getGithubUserLookups(uniqueDeployers) : new Map()

    const readinessPeriodKey =
      periodTypeRaw === 'custom' ? `${periodTypeRaw}:${periodStart}:${periodEnd}` : `${periodTypeRaw}:${periodStart}`

    return { readiness, readinessPeriodKey, userMappings: serializeUserLookups(userMappings) }
  }

  if (action === 'generate_report') {
    const periodTypeRaw = formData.get('period_type') as string
    const periodLabel = formData.get('period_label') as string
    const periodStartStr = formData.get('period_start') as string
    const periodEndStr = formData.get('period_end') as string
    const year = Number(formData.get('year'))
    const supersedeReason = (formData.get('supersede_reason') as string)?.trim() || undefined

    if (!appId || !periodStartStr || !periodEndStr || !periodLabel || !year) {
      return { error: 'Mangler påkrevde felter for rapportgenerering' }
    }

    if (!periodTypeRaw || !isValidReportPeriodType(periodTypeRaw)) {
      return { error: 'Ugyldig periodetype' }
    }
    const periodType = periodTypeRaw

    let periodStart: Date
    let periodEnd: Date
    try {
      periodStart = parseLocalDate(periodStartStr)
      periodEnd = endOfDay(parseLocalDate(periodEndStr))
    } catch {
      return { error: 'Ugyldig datoformat for periode (forventet YYYY-MM-DD)' }
    }

    if (periodEnd > new Date()) {
      return { error: 'Kan ikke generere rapport for ufullstendige perioder' }
    }

    const hasExisting = await hasActiveReportForPeriod(appId, periodType, periodStart, periodEnd)
    if (hasExisting && !supersedeReason) {
      return { error: 'Du må oppgi en begrunnelse når du erstatter en eksisterende rapport.' }
    }

    const readiness = await checkAuditReadiness(appId, periodStart, periodEnd)
    if (!readiness.is_ready) {
      const reasons: string[] = []
      if (readiness.total_deployments === 0) {
        reasons.push('Ingen deployments funnet i perioden')
      }
      if (readiness.pending_count > 0) {
        reasons.push(`${readiness.pending_count} deployments mangler godkjenning`)
      }
      if (readiness.missing_approver_count > 0) {
        reasons.push(`${readiness.missing_approver_count} godkjente deployments mangler godkjenner-data`)
      }
      if (readiness.manual_trigger_count > 0) {
        reasons.push(`${readiness.manual_trigger_count} deployments ble manuelt trigget i GitHub Actions`)
      }
      return {
        error: `Kan ikke generere rapport: ${reasons.join('; ')}.`,
        readiness,
        readinessPeriodKey:
          periodType === 'custom'
            ? `${periodType}:${periodStartStr}:${periodEndStr}`
            : `${periodType}:${periodStartStr}`,
      }
    }

    let jobId: string
    try {
      const job = await createReportJob(appId, year, periodType, periodLabel, periodStart, periodEnd)
      jobId = job.jobId
      if (!job.created) {
        if (isStaleJob({ status: job.status, created_at: job.createdAt, started_at: job.startedAt })) {
          processReportJobAsync({
            jobId: job.jobId,
            appId,
            year,
            periodType,
            periodLabel,
            periodStart,
            periodEnd,
            generatedBy: user.navIdent,
            supersedeReason,
          }).catch((err) => {
            logger.error(`Stale job re-trigger failed for ${job.jobId}:`, err)
          })
        }
        return { jobStarted: jobId }
      }
    } catch (err) {
      logger.error('Failed to create report job', err)
      return { error: 'Kunne ikke opprette rapportjobb. Sjekk serverloggen for detaljer.' }
    }

    processReportJobAsync({
      jobId,
      appId,
      year,
      periodType,
      periodLabel,
      periodStart,
      periodEnd,
      generatedBy: user.navIdent,
      supersedeReason,
    }).catch((err) => {
      logger.error(`Report job ${jobId} failed:`, err)
    })

    return { jobStarted: jobId }
  }

  if (action === 'fetch_verification_data') {
    const debug = formData.get('debug') === 'on'
    const refreshDisplayData = formData.get('refresh_display_data') === 'on'
    const jobOptions =
      debug || refreshDisplayData
        ? { ...(debug ? { debug: true } : {}), ...(refreshDisplayData ? { refreshDisplayData: true } : {}) }
        : undefined
    const jobId = await acquireSyncLock('fetch_verification_data', appId, 5, jobOptions)
    if (!jobId) {
      return { error: 'En datahenting kjører allerede for denne appen' }
    }

    processFetchDataJobAsync(jobId, appId).catch((err) => {
      logger.error(`Fetch data job ${jobId} failed`, err instanceof Error ? err : new Error(String(err)))
    })

    return { fetchJobStarted: jobId }
  }

  if (action === 'check_fetch_job_status') {
    return { fetchJobStatus: authorizedJob }
  }

  if (action === 'cancel_fetch_job') {
    if (!authorizedJob) {
      return { error: 'Mangler eller ugyldig job_id' }
    }
    const cancelled = await cancelSyncJob(authorizedJob.id)
    if (!cancelled) {
      return { error: 'Kunne ikke avbryte jobben (kanskje den allerede er ferdig?)' }
    }
    return { success: 'Jobben ble avbrutt' }
  }

  if (action === 'force_release_job') {
    if (!authorizedJob) {
      return { error: 'Mangler eller ugyldig job_id' }
    }
    const released = await forceReleaseSyncJob(authorizedJob.id)
    if (!released) {
      return { error: 'Kunne ikke frigjøre jobben' }
    }
    return { success: 'Jobben ble tvangsfrigjort' }
  }

  if (action === 'compute_diffs') {
    if (Number.isNaN(appId)) {
      return { error: 'Mangler app_id' }
    }
    const jobId = await acquireSyncLock('reverify_app', appId, 10)
    if (!jobId) {
      const latest = await getLatestSyncJob(appId, 'reverify_app')
      if (latest?.status === 'running') {
        return { error: 'En avviksberegning kjører allerede for denne appen' }
      }
      if (latest?.started_at) {
        const elapsedMs = Date.now() - new Date(latest.started_at).getTime()
        const remainingSec = Math.max(1, Math.ceil((SYNC_INTERVAL_MS - elapsedMs) / 1000))
        const unit = remainingSec === 1 ? 'sekund' : 'sekunder'
        return {
          error: `Avviksberegningen ble nettopp kjørt. Vent ${remainingSec} ${unit} før du prøver igjen.`,
        }
      }
      return { error: 'Kunne ikke starte avviksberegning. Prøv igjen om litt.' }
    }
    processComputeDiffsJobAsync(jobId, appId).catch((err) => {
      logger.error(`Compute diffs job ${jobId} failed`, err instanceof Error ? err : new Error(String(err)))
    })
    return { computeDiffsJobStarted: jobId }
  }

  if (action === 'check_compute_diffs_status') {
    return { computeDiffsJobStatus: authorizedJob }
  }

  if (action === 'update_slack_config') {
    const slackChannelId = (formData.get('slack_channel_id') as string)?.trim() || null
    const slackNotificationsEnabled = formData.get('slack_notifications_enabled') === 'true'

    if (slackChannelId && !isValidSlackChannel(slackChannelId)) {
      return { error: 'Ugyldig kanal-format. Bruk kanal-ID (C01234567) eller kanalnavn (#kanal-navn)' }
    }

    const result = await updateSlackSettingWithAudit({
      appId,
      settingKey: 'slack_notifications_enabled',
      enabledField: 'slack_notifications_enabled',
      channelField: 'slack_channel_id',
      channelId: slackChannelId,
      enabled: slackNotificationsEnabled,
      changedByNavIdent: user.navIdent,
      changedByName: user.name,
    })
    if (result.error) {
      return { error: result.error }
    }

    return { success: 'Slack-innstillinger oppdatert!' }
  }

  if (action === 'update_slack_deploy_config') {
    const slackDeployChannelId = (formData.get('slack_deploy_channel_id') as string)?.trim() || null
    const slackDeployNotifyEnabled = formData.get('slack_deploy_notify_enabled') === 'true'

    if (slackDeployChannelId && !isValidSlackChannel(slackDeployChannelId)) {
      return { error: 'Ugyldig kanal-format. Bruk kanal-ID (C01234567) eller kanalnavn (#kanal-navn)' }
    }

    const result = await updateSlackSettingWithAudit({
      appId,
      settingKey: 'slack_deploy_notify_enabled',
      enabledField: 'slack_deploy_notify_enabled',
      channelField: 'slack_deploy_channel_id',
      channelId: slackDeployChannelId,
      enabled: slackDeployNotifyEnabled,
      changedByNavIdent: user.navIdent,
      changedByName: user.name,
    })
    if (result.error) {
      return { error: result.error }
    }

    return { success: 'Deployment-varsler oppdatert!' }
  }

  if (action === 'update_reminder_config') {
    const reminderEnabled = formData.get('reminder_enabled') === 'true'
    const reminderTime = (formData.get('reminder_time') as string)?.trim() || '09:00'
    const reminderDays = formData.getAll('reminder_days') as string[]

    if (!/^\d{2}:\d{2}$/.test(reminderTime)) {
      return { error: 'Ugyldig tidsformat. Bruk HH:mm (f.eks. 09:00)' }
    }

    await updateMonitoredApplication(appId, {
      reminder_enabled: reminderEnabled,
      reminder_time: reminderTime,
      reminder_days: reminderDays.length > 0 ? reminderDays : ['mon', 'tue', 'wed', 'thu', 'fri'],
    })
    return { success: 'Purre-innstillinger oppdatert!' }
  }

  if (action === 'send_reminder') {
    const teamSlug = getFormString(formData, 'team_slug')
    const environmentName = getFormString(formData, 'environment_name')
    const appName = getFormString(formData, 'app_name')
    if (!teamSlug || !environmentName || !appName) {
      return { error: 'Mangler team_slug, environment_name eller app_name' }
    }
    const app = await getMonitoredApplicationByIdentity(teamSlug, environmentName, appName)
    if (!app?.slack_channel_id) {
      return { error: 'Slack-kanal er ikke konfigurert for denne appen' }
    }

    const { sendReminderForApp } = await import('~/lib/reminder-scheduler.server')
    const sent = await sendReminderForApp(
      app.id,
      app.team_slug,
      app.environment_name,
      app.app_name,
      app.slack_channel_id,
    )
    if (sent) {
      return { success: 'Purring sendt!' }
    }
    return { error: 'Ingen deployments å purre på, eller purring nylig sendt.' }
  }

  if (action === 'archive_report') {
    if (!Number.isFinite(appId)) {
      return { error: 'Ugyldig app-ID' }
    }
    const reportId = parseInt(formData.get('report_id') as string, 10)
    if (!Number.isFinite(reportId)) {
      return { error: 'Ugyldig rapport-ID' }
    }
    const reason = (formData.get('archive_reason') as string)?.trim()
    if (!reason) {
      return { error: 'Begrunnelse er påkrevd for arkivering' }
    }
    const archived = await archiveAuditReport(reportId, appId, user.navIdent, reason)
    if (!archived) {
      return { error: 'Rapporten finnes ikke eller er allerede arkivert' }
    }
    return { success: 'Rapporten er arkivert' }
  }

  if (action === 'restore_report') {
    if (!Number.isFinite(appId)) {
      return { error: 'Ugyldig app-ID' }
    }
    const reportId = parseInt(formData.get('report_id') as string, 10)
    if (!Number.isFinite(reportId)) {
      return { error: 'Ugyldig rapport-ID' }
    }
    const restored = await restoreAuditReport(reportId, appId, user.navIdent)
    if (!restored) {
      return { error: 'Rapporten finnes ikke eller er ikke arkivert' }
    }
    return { success: 'Rapporten er gjenopprettet' }
  }

  if (action === 'deactivate_app') {
    if (!Number.isFinite(appId)) {
      return { error: 'Ugyldig app-ID' }
    }
    const targetApp = await getMonitoredApplicationById(appId)
    if (!targetApp) {
      return { error: 'Applikasjonen finnes ikke' }
    }
    if (!targetApp.not_found_in_nais_at) {
      return { error: 'Applikasjonen er ikke markert som ikke funnet i Nais' }
    }
    await updateMonitoredApplication(appId, { is_active: false })
    return { success: 'Applikasjonen ble deaktivert' }
  }

  if (action === 'reactivate_app') {
    if (!Number.isFinite(appId)) {
      return { error: 'Ugyldig app-ID' }
    }
    const targetApp = await getMonitoredApplicationById(appId)
    if (!targetApp) {
      return { error: 'Applikasjonen finnes ikke' }
    }
    if (targetApp.is_active) {
      return { error: 'Applikasjonen er allerede aktiv' }
    }
    await updateMonitoredApplication(appId, { is_active: true, not_found_in_nais_at: null })
    return { success: 'Applikasjonen ble reaktivert' }
  }

  return null
}
