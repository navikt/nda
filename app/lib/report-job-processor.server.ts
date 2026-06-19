/**
 * Shared report generation logic used by both the web admin UI and M2M API.
 *
 * Orchestrates: job status update → data fetch → report save → PDF → store.
 */

import {
  archiveAuditReport,
  buildReportData,
  getAuditReportData,
  saveAuditReport,
  saveAuditReportFile,
} from '~/db/audit-reports.server'
import { claimReportJob, setReportJobAuditReportId, updateReportJobStatus } from '~/db/report-jobs.server'
import { generateAuditReportExcel } from '~/lib/audit-report-excel.server'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import { logger } from '~/lib/logger.server'
import type { ReportPeriodType } from '~/lib/report-periods'

interface ReportJobParams {
  jobId: string
  appId: number
  year: number
  periodType: ReportPeriodType
  periodLabel: string
  periodStart: Date
  periodEnd: Date
  generatedBy?: string
  generatedByApp?: string
  supersedeReason?: string
}

/**
 * Process a report generation job in background (fire-and-forget).
 * Used by both web admin actions and M2M generate endpoint.
 */
export async function processReportJobAsync(params: ReportJobParams) {
  const {
    jobId,
    appId,
    year,
    periodType,
    periodLabel,
    periodStart,
    periodEnd,
    generatedBy,
    generatedByApp,
    supersedeReason,
  } = params
  let reportId: number | null = null
  try {
    const claimed = await claimReportJob(jobId)
    if (!claimed) {
      return // Another processor already claimed this job
    }

    const rawData = await getAuditReportData(appId, periodStart, periodEnd)
    const reportData = buildReportData(rawData)

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
      generatedByApp,
      supersedeReason,
    })

    reportId = report.id

    // Link job to the created report
    await setReportJobAuditReportId(jobId, report.id)

    const reportProps = {
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
    }

    const [pdfResult, excelResult] = await Promise.allSettled([
      generateAuditReportPdf({
        ...reportProps,
        testRequirement: rawData.app.test_requirement as 'none' | 'unit_tests' | 'integration_tests',
      }),
      generateAuditReportExcel(reportProps),
    ])

    if (pdfResult.status === 'rejected') throw pdfResult.reason
    const pdfBuffer = pdfResult.value

    await saveAuditReportFile(report.id, 'pdf', pdfBuffer)

    if (excelResult.status === 'fulfilled') {
      try {
        await saveAuditReportFile(report.id, 'xlsx', excelResult.value)
      } catch (xlsxSaveErr) {
        logger.error(
          'Excel save failed (non-blocking):',
          xlsxSaveErr instanceof Error ? xlsxSaveErr : new Error(String(xlsxSaveErr)),
        )
      }
    } else {
      logger.error(
        'Excel generation failed (non-blocking):',
        excelResult.reason instanceof Error ? excelResult.reason : new Error(String(excelResult.reason)),
      )
    }
    await updateReportJobStatus(jobId, 'completed', pdfBuffer)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await updateReportJobStatus(jobId, 'failed', undefined, errorMessage)

    // Archive incomplete report (no PDF) so it doesn't block retries
    if (reportId) {
      await archiveAuditReport(reportId, appId, generatedBy ?? generatedByApp ?? 'system', 'Report generation failed')
    }

    throw err
  }
}
