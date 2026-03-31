import { updateImplicitApprovalSettings } from '~/db/app-settings.server'
import {
  buildReportData,
  checkAuditReadiness,
  getAuditReportData,
  saveAuditReport,
  updateAuditReportPdf,
} from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity, updateMonitoredApplication } from '~/db/monitored-applications.server'
import { createReportJob, updateReportJobStatus } from '~/db/report-jobs.server'
import {
  acquireSyncLock,
  cancelSyncJob,
  forceReleaseSyncJob,
  getSyncJobById,
  getSyncJobOptions,
  releaseSyncLock,
} from '~/db/sync-jobs.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import { requireAdmin } from '~/lib/auth.server'
import { isValidSlackChannel } from '~/lib/form-validators'
import { logger, runWithJobContext } from '~/lib/logger.server'
import type { ReportPeriodType } from '~/lib/report-periods'
import { fetchVerificationDataForAllDeployments } from '~/lib/verification'
import { computeVerificationDiffs } from '~/lib/verification/compute-diffs.server'

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
      const result = await computeVerificationDiffs(appId, { jobId })
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

interface ReportJobParams {
  jobId: string
  appId: number
  year: number
  periodType: ReportPeriodType
  periodLabel: string
  periodStart: Date
  periodEnd: Date
  generatedBy: string
}

// Async function to process report generation in background
async function processReportJobAsync(params: ReportJobParams) {
  const { jobId, appId, year, periodType, periodLabel, periodStart, periodEnd, generatedBy } = params
  try {
    await updateReportJobStatus(jobId, 'processing')

    const rawData = await getAuditReportData(appId, periodStart, periodEnd)
    const reportData = buildReportData(rawData)

    // Save report metadata
    const report = await saveAuditReport({
      monitoredAppId: appId,
      appName: rawData.app.app_name,
      teamSlug: rawData.app.team_slug,
      environmentName: rawData.app.environment_name,
      repository: rawData.repository,
      year,
      periodType,
      periodLabel,
      periodStart,
      periodEnd,
      reportData,
      generatedBy,
    })

    // Generate PDF
    const pdfBuffer = await generateAuditReportPdf({
      appName: report.app_name,
      repository: report.repository,
      teamSlug: report.team_slug,
      environmentName: report.environment_name,
      year: report.year,
      periodLabel: report.period_label,
      periodStart: new Date(report.period_start),
      periodEnd: new Date(report.period_end),
      reportData: report.report_data,
      contentHash: report.content_hash,
      reportId: report.report_id,
      generatedAt: new Date(report.generated_at),
      testRequirement: rawData.app.test_requirement as 'none' | 'unit_tests' | 'integration_tests',
    })

    // Store PDF in audit_reports table
    await updateAuditReportPdf(report.id, Buffer.from(pdfBuffer))

    // Update job with PDF data and mark completed
    await updateReportJobStatus(jobId, 'completed', pdfBuffer)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await updateReportJobStatus(jobId, 'failed', undefined, errorMessage)
    throw err
  }
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
    const mode = formData.get('mode') as 'off' | 'dependabot_only' | 'all'
    if (!['off', 'dependabot_only', 'all'].includes(mode)) {
      return { error: 'Ugyldig modus' }
    }

    await updateImplicitApprovalSettings({
      monitoredAppId: appId,
      settings: { mode },
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
    if (!appId || !periodStart || !periodEnd) {
      return { error: 'Mangler app eller periode' }
    }
    const readiness = await checkAuditReadiness(appId, new Date(periodStart), new Date(periodEnd))
    return { readiness }
  }

  if (action === 'generate_report') {
    const periodType = (formData.get('period_type') as ReportPeriodType) || 'yearly'
    const periodLabel = formData.get('period_label') as string
    const periodStartStr = formData.get('period_start') as string
    const periodEndStr = formData.get('period_end') as string
    const year = Number(formData.get('year'))

    if (!appId || !periodStartStr || !periodEndStr || !periodLabel || !year) {
      return { error: 'Mangler påkrevde felter for rapportgenerering' }
    }

    const periodStart = new Date(periodStartStr)
    const periodEnd = new Date(periodEndStr)

    // Block incomplete periods
    if (periodEnd > new Date()) {
      return { error: 'Kan ikke generere rapport for ufullstendige perioder' }
    }

    // Check readiness first
    const readiness = await checkAuditReadiness(appId, periodStart, periodEnd)
    if (!readiness.is_ready) {
      return {
        error: `Kan ikke generere rapport. ${readiness.pending_count} deployments mangler godkjenning.`,
        readiness,
      }
    }

    // Create background job for PDF generation
    let jobId: string
    try {
      jobId = await createReportJob(appId, year, periodType, periodLabel, periodStart, periodEnd)
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
      return { error: 'En avviksberegning kjører allerede for denne appen' }
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

  return null
}
