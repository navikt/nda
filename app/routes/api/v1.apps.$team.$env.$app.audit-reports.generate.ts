/**
 * API: Generate (order) an audit report
 *
 * Creates an async report generation job. Deduplicates against in-flight jobs.
 * Secured with M2M token validation.
 *
 * POST /api/v1/apps/:team/:env/:app/audit-reports/generate
 *
 * Request body:
 *   { periodType, periodStart, reason? }
 */

import { getReportSummaryById, hasActiveReportForPeriod } from '~/db/audit-reports.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { createReportJob, findInFlightJob, isStaleJob } from '~/db/report-jobs.server'
import { buildAppMetadata } from '~/lib/api/app-metadata.server'
import { jsonError, validateProdEnvironment } from '~/lib/api/errors'
import type { AuditReportGenerateResponse } from '~/lib/api/types'
import { parseLocalDate } from '~/lib/date-utils'
import { logger } from '~/lib/logger.server'
import { requireM2MToken } from '~/lib/m2m-auth.server'
import { processReportJobAsync } from '~/lib/report-job-processor.server'
import { isValidReportPeriodType, type ReportPeriodType, resolvePeriod } from '~/lib/report-periods'
import type { Route } from './+types/v1.apps.$team.$env.$app.audit-reports.generate'

export async function action({ request, params }: Route.ActionArgs) {
  const token = await requireM2MToken(request)

  const { team, env, app: appName } = params

  const envError = validateProdEnvironment(env)
  if (envError) throw envError

  let body: { periodType?: string; periodStart?: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    throw jsonError('Invalid JSON in request body', 400)
  }

  const { periodType, periodStart: periodStartParam, reason: rawReason } = body
  const reason = rawReason?.trim() || undefined

  if (!periodType || !periodStartParam) {
    throw jsonError('Missing required fields: periodType and periodStart', 400)
  }

  if (!isValidReportPeriodType(periodType)) {
    throw jsonError(`Invalid periodType: ${periodType}. Valid values: yearly, tertiary, quarterly, monthly`, 400)
  }

  let periodStartDate: Date
  try {
    periodStartDate = parseLocalDate(periodStartParam)
  } catch {
    throw jsonError('Invalid periodStart. Use format YYYY-MM-DD', 400)
  }

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!monitoredApp) {
    throw jsonError('Application not found', 404)
  }

  const resolved = resolvePeriod(periodType as ReportPeriodType, periodStartDate, monitoredApp.audit_start_year)
  if (resolved.error !== null) {
    throw jsonError(resolved.error, 400)
  }

  const period = resolved.period

  // Check for existing in-flight job (deduplication for pending/processing only)
  const existingJob = await findInFlightJob(monitoredApp.id, period.type, period.startDate)
  if (existingJob && (existingJob.status !== 'completed' || !reason)) {
    // Re-trigger stale pending jobs that were never picked up
    if (isStaleJob(existingJob)) {
      processReportJobAsync({
        jobId: existingJob.job_id,
        appId: monitoredApp.id,
        year: period.year,
        periodType: period.type,
        periodLabel: period.label,
        periodStart: period.startDate,
        periodEnd: period.endDate,
        generatedByApp: token.azpName ?? token.azp,
        supersedeReason: reason,
      }).catch((err) => {
        logger.error(`Stale job re-trigger failed for ${existingJob.job_id}:`, err)
      })
    }

    const appMetadata = await buildAppMetadata(monitoredApp)

    // For completed jobs, find the report_id via audit_report_id
    let reportId: string | null = null
    if (existingJob.status === 'completed' && existingJob.audit_report_id) {
      const report = await getReportSummaryById(existingJob.audit_report_id)
      reportId = report?.report_id ?? null
    }

    const response: AuditReportGenerateResponse = {
      app: appMetadata,
      jobId: existingJob.job_id,
      status: existingJob.status as AuditReportGenerateResponse['status'],
      reportId,
      message: 'Existing job returned',
    }

    return Response.json(response, { status: 200 })
  }

  // Check if superseding is needed
  const hasExisting = await hasActiveReportForPeriod(monitoredApp.id, period.type, period.startDate, period.endDate)
  if (hasExisting && !reason) {
    throw jsonError('An active report already exists for this period. Provide "reason" to supersede it.', 409)
  }

  // Create new job
  const job = await createReportJob(
    monitoredApp.id,
    period.year,
    period.type,
    period.label,
    period.startDate,
    period.endDate,
  )

  // If we hit the unique constraint (race condition), return existing job without starting processing
  if (!job.created) {
    const appMetadata = await buildAppMetadata(monitoredApp)
    const response: AuditReportGenerateResponse = {
      app: appMetadata,
      jobId: job.jobId,
      status: job.status as AuditReportGenerateResponse['status'],
      reportId: null,
      message: 'Existing job returned',
    }
    return Response.json(response, { status: 200 })
  }

  // Fire-and-forget async generation
  processReportJobAsync({
    jobId: job.jobId,
    appId: monitoredApp.id,
    year: period.year,
    periodType: period.type,
    periodLabel: period.label,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    generatedByApp: token.azpName ?? token.azp,
    supersedeReason: reason,
  }).catch((err) => {
    logger.error(`Report generation failed for job ${job.jobId}:`, err)
  })

  const appMetadata = await buildAppMetadata(monitoredApp)

  const response: AuditReportGenerateResponse = {
    app: appMetadata,
    jobId: job.jobId,
    status: 'pending',
    reportId: null,
    message: 'Report generation started',
  }

  return Response.json(response, { status: 202 })
}
