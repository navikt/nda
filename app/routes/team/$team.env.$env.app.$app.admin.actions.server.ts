import { recordAppConfigAuditLog } from '~/db/app-settings.server'
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
import { getEffectiveAuditStartYear } from '~/db/repositories.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import { PROD_ENVIRONMENTS } from '~/lib/api/errors'
import { requireUser } from '~/lib/auth.server'
import { canAccessAppAdmin } from '~/lib/authorization.server'
import { endOfDay, parseLocalDate } from '~/lib/date-utils'
import { getFormString, isValidSlackChannel } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { processReportJobAsync } from '~/lib/report-job-processor.server'
import { buildCustomPeriod, isValidReportPeriodType, type ReportPeriodType, resolvePeriod } from '~/lib/report-periods'
import type { SlackConfigSettingKey } from '~/lib/slack/config-setting-keys'
import { serializeUserLookups } from '~/lib/user-display'

class AppNotFoundError extends Error {}

interface ResolvedReportPeriod {
  periodType: ReportPeriodType
  periodLabel: string
  year: number
  periodStart: Date
  periodEnd: Date
}

const RESOLVE_PERIOD_ERROR_TRANSLATIONS: Record<string, string> = {
  'periodStart must be the 1st of the month': 'Fra-dato må være den 1. i måneden',
  'periodStart for yearly must be January 1st (YYYY-01-01)': 'Fra-dato for årlig periode må være 1. januar',
  'periodStart for tertiary must start in January, May, or September':
    'Fra-dato for tertialsvis periode må starte i januar, mai eller september',
  'periodStart for quarterly must start in January, April, July, or October':
    'Fra-dato for kvartalsvis periode må starte i januar, april, juli eller oktober',
  'Period has not ended yet': 'Kan ikke generere rapport for ufullstendige perioder',
}

async function resolveAndValidateReportPeriod(
  appId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ period: ResolvedReportPeriod; error: null } | { period: null; error: string }> {
  if (periodStart > periodEnd) {
    return { period: null, error: 'Ugyldig periode: fra-dato kan ikke være etter til-dato' }
  }

  const app = await getMonitoredApplicationById(appId)
  if (!app) {
    return { period: null, error: 'Fant ikke applikasjonen' }
  }
  if (!PROD_ENVIRONMENTS.has(app.environment_name)) {
    return { period: null, error: 'Leveranserapporter kan kun genereres for produksjonsmiljøer (prod-fss, prod-gcp)' }
  }

  const auditStartYear = await getEffectiveAuditStartYear(appId)
  if (auditStartYear !== null && periodStart.getFullYear() < auditStartYear) {
    return { period: null, error: `Perioden starter før appens revisjonsstartår (${auditStartYear})` }
  }

  if (periodType === 'custom') {
    const resolvedCustom = buildCustomPeriod(
      periodStart.getFullYear(),
      periodStart.getMonth(),
      periodEnd.getFullYear(),
      periodEnd.getMonth(),
    )
    const isAligned =
      !!resolvedCustom &&
      resolvedCustom.startDate.getTime() === periodStart.getTime() &&
      resolvedCustom.endDate.getTime() === periodEnd.getTime()

    if (!isAligned) {
      const expectedEnd = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 0, 23, 59, 59, 999)
      if (expectedEnd >= new Date()) {
        return { period: null, error: 'Kan ikke generere rapport for ufullstendige perioder' }
      }
      return { period: null, error: 'Egendefinert periode må dekke hele kalendermåneder' }
    }

    return {
      period: {
        periodType: 'custom',
        periodLabel: resolvedCustom.label,
        year: resolvedCustom.year,
        periodStart: resolvedCustom.startDate,
        periodEnd: resolvedCustom.endDate,
      },
      error: null,
    }
  }

  const resolved = resolvePeriod(periodType, periodStart, null)
  if (resolved.error !== null) {
    return { period: null, error: RESOLVE_PERIOD_ERROR_TRANSLATIONS[resolved.error] ?? resolved.error }
  }

  return {
    period: {
      periodType,
      periodLabel: resolved.period.label,
      year: resolved.period.year,
      periodStart: resolved.period.startDate,
      periodEnd: resolved.period.endDate,
    },
    error: null,
  }
}

async function updateSlackSettingWithAudit(params: {
  appId: number
  settingKey: SlackConfigSettingKey
  enabledField: 'slack_notifications_enabled' | 'slack_deploy_notify_enabled' | 'reminder_enabled'
  channelField: 'slack_channel_id' | 'slack_deploy_channel_id' | 'reminder_channel_id'
  channelId: string | null
  enabled: boolean
  changedByNavIdent: string
  changedByName?: string
  extraUpdates?: Parameters<typeof updateMonitoredApplication>[1]
}): Promise<{ error?: string }> {
  const {
    appId,
    settingKey,
    enabledField,
    channelField,
    channelId,
    enabled,
    changedByNavIdent,
    changedByName,
    extraUpdates,
  } = params

  try {
    await withTransaction(async (client) => {
      const currentApp = await getMonitoredApplicationById(appId, client)
      if (!currentApp) {
        throw new AppNotFoundError()
      }

      await updateMonitoredApplication(
        appId,
        { ...extraUpdates, [channelField]: channelId, [enabledField]: enabled },
        client,
      )

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

export async function action({ request }: { request: Request; params: Record<string, string | undefined> }) {
  const user = await requireUser(request)

  const formData = await request.formData()
  const action = formData.get('action') as string
  const appId = parseInt(formData.get('app_id') as string, 10)

  if (action === 'send_reminder') {
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

  if (action === 'update_test_requirement') {
    const testRequirement = formData.get('test_requirement') as 'none' | 'unit_tests' | 'integration_tests'
    if (!['none', 'unit_tests', 'integration_tests'].includes(testRequirement)) {
      return { error: 'Ugyldig testkrav' }
    }

    await updateMonitoredApplication(appId, { test_requirement: testRequirement })
    return { success: 'Testkrav oppdatert!' }
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
    let parsedEnd: Date
    try {
      parsedStart = parseLocalDate(periodStart)
      parsedEnd = endOfDay(parseLocalDate(periodEnd))
    } catch {
      return { error: 'Ugyldig datoformat for periode (forventet YYYY-MM-DD)' }
    }

    const resolved = await resolveAndValidateReportPeriod(appId, periodTypeRaw, parsedStart, parsedEnd)
    if (resolved.error !== null) {
      return { error: resolved.error }
    }
    const { periodStart: resolvedStart, periodEnd: resolvedEnd } = resolved.period

    const readiness = await checkAuditReadiness(appId, resolvedStart, resolvedEnd)

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
    const periodStartStr = formData.get('period_start') as string
    const periodEndStr = formData.get('period_end') as string
    const supersedeReason = (formData.get('supersede_reason') as string)?.trim() || undefined

    if (!appId || !periodStartStr || !periodEndStr) {
      return { error: 'Mangler påkrevde felter for rapportgenerering' }
    }

    if (!periodTypeRaw || !isValidReportPeriodType(periodTypeRaw)) {
      return { error: 'Ugyldig periodetype' }
    }

    let parsedStart: Date
    let parsedEnd: Date
    try {
      parsedStart = parseLocalDate(periodStartStr)
      parsedEnd = endOfDay(parseLocalDate(periodEndStr))
    } catch {
      return { error: 'Ugyldig datoformat for periode (forventet YYYY-MM-DD)' }
    }

    if (parsedEnd > new Date()) {
      return { error: 'Kan ikke generere rapport for ufullstendige perioder' }
    }

    const resolved = await resolveAndValidateReportPeriod(appId, periodTypeRaw, parsedStart, parsedEnd)
    if (resolved.error !== null) {
      return { error: resolved.error }
    }
    const { periodType, periodLabel, year, periodStart, periodEnd } = resolved.period

    const hasExisting = await hasActiveReportForPeriod(appId, periodType, periodStart, periodEnd)
    if (hasExisting && !supersedeReason) {
      return { error: 'Du må oppgi en begrunnelse når du erstatter en eksisterende rapport.' }
    }

    const readiness = await checkAuditReadiness(appId, periodStart, periodEnd)
    if (!readiness.is_ready) {
      const reasons: string[] = []
      if (readiness.pending_count > 0) {
        reasons.push(`${readiness.pending_count} deployments mangler godkjenning`)
      }
      if (readiness.unverifiable_count > 0) {
        reasons.push(`${readiness.unverifiable_count} deployments mangler repository-info og kan ikke verifiseres`)
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
    const reminderChannelId = (formData.get('reminder_channel_id') as string)?.trim() || null

    if (!/^\d{2}:\d{2}$/.test(reminderTime)) {
      return { error: 'Ugyldig tidsformat. Bruk HH:mm (f.eks. 09:00)' }
    }

    if (reminderChannelId && !isValidSlackChannel(reminderChannelId)) {
      return { error: 'Ugyldig kanal-format. Bruk kanal-ID (C01234567) eller kanalnavn (#kanal-navn)' }
    }

    const auditResult = await updateSlackSettingWithAudit({
      appId,
      settingKey: 'reminder_enabled',
      enabledField: 'reminder_enabled',
      channelField: 'reminder_channel_id',
      channelId: reminderChannelId,
      enabled: reminderEnabled,
      changedByNavIdent: user.navIdent,
      changedByName: user.name,
      extraUpdates: {
        reminder_time: reminderTime,
        reminder_days: reminderDays.length > 0 ? reminderDays : ['mon', 'tue', 'wed', 'thu', 'fri'],
      },
    })
    if (auditResult.error) {
      return { error: auditResult.error }
    }

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
    if (!app?.reminder_channel_id) {
      return { error: 'Slack-kanal for purringer er ikke konfigurert for denne appen' }
    }

    const { sendReminderForApp } = await import('~/lib/reminder-scheduler.server')
    const sent = await sendReminderForApp(
      app.id,
      app.team_slug,
      app.environment_name,
      app.app_name,
      app.reminder_channel_id,
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
