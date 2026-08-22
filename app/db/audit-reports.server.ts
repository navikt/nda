import { toDateString } from '~/lib/date-utils'
import type { ReportPeriodType } from '~/lib/report-periods'
import { pool } from './connection.server'

export type { AuditReportSummary } from './audit-reports/admin-retrieval.server'
export {
  getAllAuditReports,
  getAuditReportById,
  getAuditReportsForApp,
  getAuditReportsForAppAdmin,
} from './audit-reports/admin-retrieval.server'
export { archiveAuditReport, restoreAuditReport } from './audit-reports/archive.server'
export { getAuditReportFile, saveAuditReportFile } from './audit-reports/file-storage.server'
export type {
  AdminResetEntry,
  AuditDeploymentEntry,
  AuditGoalLinkEntry,
  AuditReportData,
  ContributorEntry,
  DeviationEntry,
  ManualApprovalEntry,
  ReviewerEntry,
  UnverifiedCommitDeploymentEntry,
  UnverifiedCommitEntry,
} from './audit-reports/generation.server'
export { buildReportData, getAuditReportData, saveAuditReport } from './audit-reports/generation.server'
export type { AuditReadinessCheck } from './audit-reports/readiness.server'
export { checkAuditReadiness } from './audit-reports/readiness.server'

export async function hasActiveReportForPeriod(
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
  periodEnd: Date,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM audit_reports
     WHERE monitored_app_id = $1
       AND period_type = $2
       AND period_start = $3::date
       AND period_end = $4::date
       AND superseded_at IS NULL
       AND archived_at IS NULL
     LIMIT 1`,
    [monitoredAppId, periodType, toDateString(periodStart), toDateString(periodEnd)],
  )
  return result.rows.length > 0
}

export {
  getActiveReportsForAppM2M,
  getActiveReportsForPeriodM2M,
  getReportByReportIdForApp,
  getReportSummaryById,
} from './audit-reports/m2m.server'
