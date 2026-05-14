import { updateImplicitApprovalSettings } from '~/db/app-settings.server'
import {
  archiveAuditReport,
  checkAuditReadiness,
  hasActiveReportForPeriod,
  restoreAuditReport,
} from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity, updateMonitoredApplication } from '~/db/monitored-applications.server'
import { createReportJob, isStaleJob } from '~/db/report-jobs.server'
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
import { getUserMappings } from '~/db/user-mappings.server'
import { requireAdmin } from '~/lib/auth.server'
import { endOfDay, parseLocalDate } from '~/lib/date-utils'
import { isValidSlackChannel } from '~/lib/form-validators'
import { logger, runWithJobContext } from '~/lib/logger.server'
import { processReportJobAsync } from '~/lib/report-job-processor.server'
import { isValidReportPeriodType } from '~/lib/report-periods'
import { serializeUserMappings } from '~/lib/user-display'
import { fetchVerificationDataForAllDeployments } from '~/lib/verification'
import { computeVerificationDiffs } from '~/lib/verification/compute-diffs.server'
import { isImplicitApprovalMode } from '~/lib/verification/types'

// Async function to process data fetch job in background
async function processFetchDataJobAsync(jobId: number, appId: number) {
  const options = await getSyncJobOptions(jobId)
  const debug = options?.debug === true

  await runWithJobContext(jobId, debug, async () => {
    try {
      const result = await fetchVerificationDataForAllDeployments(appId, { jobId })
      // Only release as completed if not cancelled
      const job = await getSyncJobById(jobId)
      if (job?.status === 'cancelled') {
        return
      }
      await releaseSyncLock(jobId, 'completed', result as unknown as Record<string, unknown>)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      // Don't overwrite cancelled status
      const job = await getSyncJobById(jobId)
      if (job?.status !== 'cancelled') {
        await releaseSyncLock(jobId, 'failed', undefined, errorMessage)
      }
      throw err
    }
  })
}

// Async function to compute verification diffs in background
async function processComputeDiffsJobAsync(jobId: number, appId: number) {
  await runWithJobContext(jobId, false, async () => {
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

export async function action({ request }: { request: Request; params: Record<string, string | undefined> }) {
  const user = await requireAdmin(request)

  const formData = await request.formData()
  const action = formData.get('action') as string
  const appId = parseInt(formData.get('app_id') as string, 10)

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

    // Resolve display names for deployers in pending and missing approver lists
    const deployerUsernames = [
      ...readiness.pending_deployments.map((d) => d.deployer_username),
      ...readiness.missing_approver_deployments.map((d) => d.deployer_username),
    ].filter((u): u is string => u != null)
    const uniqueDeployers = [...new Set(deployerUsernames)]
    const userMappings = uniqueDeployers.length > 0 ? await getUserMappings(uniqueDeployers) : new Map()

    const readinessPeriodKey = `${periodTypeRaw}:${periodStart}`

    return { readiness, readinessPeriodKey, userMappings: serializeUserMappings(userMappings) }
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

    // Block incomplete periods
    if (periodEnd > new Date()) {
      return { error: 'Kan ikke generere rapport for ufullstendige perioder' }
    }

    // Require reason when superseding an existing report
    const hasExisting = await hasActiveReportForPeriod(appId, periodType, periodStart)
    if (hasExisting && !supersedeReason) {
      return { error: 'Du må oppgi en begrunnelse når du erstatter en eksisterende rapport.' }
    }

    // Check readiness first
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
      return {
        error: `Kan ikke generere rapport: ${reasons.join('; ')}.`,
        readiness,
        readinessPeriodKey: `${periodType}:${periodStartStr}`,
      }
    }

    // Create background job for PDF generation
    let jobId: string
    try {
      const job = await createReportJob(appId, year, periodType, periodLabel, periodStart, periodEnd)
      jobId = job.jobId
      if (!job.created) {
        // Re-trigger stale pending jobs that were never picked up
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

    // Start async processing (fire and forget)
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
    // Try to acquire lock for this job
    const jobId = await acquireSyncLock('fetch_verification_data', appId, 5, debug ? { debug: true } : undefined) // 5 min timeout, extended by heartbeat
    if (!jobId) {
      return { error: 'En datahenting kjører allerede for denne appen' }
    }

    // Start async processing (fire and forget)
    processFetchDataJobAsync(jobId, appId).catch((err) => {
      logger.error(`Fetch data job ${jobId} failed`, err instanceof Error ? err : new Error(String(err)))
    })

    return { fetchJobStarted: jobId }
  }

  if (action === 'check_fetch_job_status') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) {
      return { error: 'Mangler job_id' }
    }
    const job = await getSyncJobById(jobId)
    return { fetchJobStatus: job }
  }

  if (action === 'cancel_fetch_job') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) {
      return { error: 'Mangler job_id' }
    }
    const cancelled = await cancelSyncJob(jobId)
    if (!cancelled) {
      return { error: 'Kunne ikke avbryte jobben (kanskje den allerede er ferdig?)' }
    }
    return { success: 'Jobben ble avbrutt' }
  }

  if (action === 'force_release_job') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) {
      return { error: 'Mangler job_id' }
    }
    const released = await forceReleaseSyncJob(jobId)
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
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) {
      return { error: 'Mangler job_id' }
    }
    const job = await getSyncJobById(jobId)
    return { computeDiffsJobStatus: job }
  }

  if (action === 'update_slack_config') {
    const slackChannelId = (formData.get('slack_channel_id') as string)?.trim() || null
    const slackNotificationsEnabled = formData.get('slack_notifications_enabled') === 'true'

    // Validate channel ID format if provided (C followed by alphanumeric, or #channel-name)
    if (slackChannelId && !isValidSlackChannel(slackChannelId)) {
      return { error: 'Ugyldig kanal-format. Bruk kanal-ID (C01234567) eller kanalnavn (#kanal-navn)' }
    }

    await updateMonitoredApplication(appId, {
      slack_channel_id: slackChannelId,
      slack_notifications_enabled: slackNotificationsEnabled,
    })
    return { success: 'Slack-innstillinger oppdatert!' }
  }

  if (action === 'update_slack_deploy_config') {
    const slackDeployChannelId = (formData.get('slack_deploy_channel_id') as string)?.trim() || null
    const slackDeployNotifyEnabled = formData.get('slack_deploy_notify_enabled') === 'true'

    if (slackDeployChannelId && !isValidSlackChannel(slackDeployChannelId)) {
      return { error: 'Ugyldig kanal-format. Bruk kanal-ID (C01234567) eller kanalnavn (#kanal-navn)' }
    }

    await updateMonitoredApplication(appId, {
      slack_deploy_channel_id: slackDeployChannelId,
      slack_deploy_notify_enabled: slackDeployNotifyEnabled,
    })
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
    const app = await getMonitoredApplicationByIdentity(
      formData.get('team_slug') as string,
      formData.get('environment_name') as string,
      formData.get('app_name') as string,
    )
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

  return null
}
