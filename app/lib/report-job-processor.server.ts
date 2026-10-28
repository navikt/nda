import { getRepositoryAuditReportData } from '~/db/audit-reports/repository-data.server'
import {
  archiveAuditReport,
  buildReportData,
  getAuditReportData,
  saveAuditReport,
  saveAuditReportFile,
} from '~/db/audit-reports.server'
import { claimReportJob, setReportJobAuditReportId, updateReportJobStatus } from '~/db/report-jobs.server'
import { generateAuditReportExcel } from '~/lib/audit-report-excel.server'
import type { AuditReportAssessmentModel } from '~/lib/audit-report-model'
import { generateAuditReportPdf } from '~/lib/audit-report-pdf'
import { logger } from '~/lib/logger.server'
import type { ReportPeriodType } from '~/lib/report-periods'
import { generateRepositoryAuditReportExcel } from '~/lib/repository-audit-report-excel.server'
import { generateRepositoryAuditReportPdf } from '~/lib/repository-audit-report-pdf'

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
  assessmentModel?: AuditReportAssessmentModel
}

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
    assessmentModel = 'application',
  } = params
  let reportId: number | null = null
  try {
    const claimed = await claimReportJob(jobId, assessmentModel)
    if (!claimed) {
      return
    }

    const data = await loadReportData(appId, periodStart, periodEnd, assessmentModel)
    const { reportData } = data

    const report = await saveAuditReport({
      monitoredAppId: appId,
      appName: data.appName,
      teamSlug: data.teamSlug,
      environmentName: data.environmentName,
      repository: data.repository,
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
      contentHash: report.content_hash,
      reportId: report.report_id,
      generatedAt: new Date(report.generated_at),
    }

    const [pdfResult, excelResult] = await Promise.allSettled(
      'assessmentModel' in reportData
        ? [
            generateRepositoryAuditReportPdf({ ...reportProps, reportData }),
            generateRepositoryAuditReportExcel({ ...reportProps, reportData }),
          ]
        : [
            generateAuditReportPdf({
              ...reportProps,
              reportData,
              testRequirement: data.testRequirement,
            }),
            generateAuditReportExcel({ ...reportProps, reportData }),
          ],
    )

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

    if (reportId) {
      await archiveAuditReport(reportId, appId, generatedBy ?? generatedByApp ?? 'system', 'Report generation failed')
    }

    throw err
  }
}

async function loadReportData(appId: number, periodStart: Date, periodEnd: Date, model: AuditReportAssessmentModel) {
  if (model === 'repository') {
    const { reportData, readiness } = await getRepositoryAuditReportData(appId, periodStart, periodEnd)
    if (!readiness.isReady) throw new Error('Repository report is not ready for generation.')
    return {
      reportData,
      appName: reportData.app.name,
      teamSlug: reportData.app.team,
      environmentName: reportData.app.environment,
      repository: [...new Set(reportData.deliveries.map((d) => `${d.githubOwner}/${d.githubRepoName}`))].join(', '),
      testRequirement: undefined,
    }
  }
  const rawData = await getAuditReportData(appId, periodStart, periodEnd)
  return {
    reportData: buildReportData(rawData),
    appName: rawData.app.app_name,
    teamSlug: rawData.app.team_slug,
    environmentName: rawData.app.environment_name,
    repository: rawData.repository,
    testRequirement: rawData.app.test_requirement as 'none' | 'unit_tests' | 'integration_tests',
  }
}
