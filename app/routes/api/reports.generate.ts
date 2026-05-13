import { createHash } from 'node:crypto'
import { data } from 'react-router'
import { buildReportData, getAuditReportData } from '~/db/audit-reports.server'
import { claimReportJob, createReportJob, isStaleJob, updateReportJobStatus } from '~/db/report-jobs.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import { requireAdmin } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import type { ReportPeriodType } from '~/lib/report-periods'
import type { Route } from './+types/reports.generate'

// POST: Create a new report generation job
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const monitoredAppId = Number(formData.get('monitoredAppId'))
  const year = Number(formData.get('year'))
  const periodType = (formData.get('period_type') as ReportPeriodType) || 'yearly'
  const periodLabel = (formData.get('period_label') as string) || String(year)
  const periodStartStr = formData.get('period_start') as string
  const periodEndStr = formData.get('period_end') as string

  if (!monitoredAppId || !year) {
    return data({ error: 'Missing monitoredAppId or year' }, { status: 400 })
  }

  const periodStart = periodStartStr ? new Date(periodStartStr) : new Date(year, 0, 1)
  const periodEnd = periodEndStr ? new Date(periodEndStr) : new Date(year, 11, 31, 23, 59, 59)

  const job = await createReportJob(monitoredAppId, year, periodType, periodLabel, periodStart, periodEnd)

  if (job.created || isStaleJob({ status: job.status, created_at: job.createdAt, started_at: job.startedAt })) {
    // Start async processing for new jobs or stale pending jobs (fire and forget)
    processReportJob(job.jobId, monitoredAppId, periodStart, periodEnd).catch((err) => {
      logger.error(`Report job ${job.jobId} failed:`, err)
    })
  }

  return data({ jobId: job.jobId })
}

// Async function to process the report job
async function processReportJob(jobId: string, monitoredAppId: number, periodStart: Date, periodEnd: Date) {
  try {
    const claimed = await claimReportJob(jobId)
    if (!claimed) {
      return // Another processor already claimed this job
    }

    const rawData = await getAuditReportData(monitoredAppId, periodStart, periodEnd)
    const reportData = buildReportData(rawData)

    const reportId = `${rawData.app.app_name}-${periodStart.getFullYear()}-${Date.now()}`
    const contentHash = createHash('sha256').update(JSON.stringify(reportData)).digest('hex')
    const generatedAt = new Date()

    const pdfBuffer = await generateAuditReportPdf({
      appName: rawData.app.app_name,
      repository: rawData.repository,
      teamSlug: rawData.app.team_slug,
      environmentName: rawData.app.environment_name,
      year: periodStart.getFullYear(),
      periodStart,
      periodEnd,
      reportData,
      contentHash,
      reportId,
      generatedAt,
      testRequirement: rawData.app.test_requirement as 'none' | 'unit_tests' | 'integration_tests',
    })

    await updateReportJobStatus(jobId, 'completed', pdfBuffer)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await updateReportJobStatus(jobId, 'failed', undefined, errorMessage)
    throw err
  }
}
