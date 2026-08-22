import { toDateString } from '~/lib/date-utils'
import type { ReportPeriodType } from '~/lib/report-periods'
import { pool } from '../connection.server'

interface M2MAuditReportRow {
  id: number
  report_id: string
  period_type: ReportPeriodType
  period_label: string
  period_start: Date
  period_end: Date
  generated_at: Date
  generated_by: string | null
  generated_by_app: string | null
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  change_origin_count: number | null
  content_hash: string
  formats: string[]
}

export async function getActiveReportsForAppM2M(monitoredAppId: number): Promise<M2MAuditReportRow[]> {
  const result = await pool.query<M2MAuditReportRow>(
    `SELECT id, report_id, period_type, period_label, period_start, period_end,
            generated_at, generated_by, generated_by_app,
            total_deployments, pr_approved_count, manually_approved_count,
            change_origin_count, content_hash,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1 AND archived_at IS NULL AND superseded_at IS NULL
       AND EXISTS (SELECT 1 FROM audit_report_files arf WHERE arf.audit_report_id = audit_reports.id AND arf.format = 'pdf')
     ORDER BY period_start DESC`,
    [monitoredAppId],
  )
  return result.rows
}

export async function getActiveReportsForPeriodM2M(
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
): Promise<M2MAuditReportRow[]> {
  const result = await pool.query<M2MAuditReportRow>(
    `SELECT id, report_id, period_type, period_label, period_start, period_end,
            generated_at, generated_by, generated_by_app,
            total_deployments, pr_approved_count, manually_approved_count,
            change_origin_count, content_hash,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1
       AND period_type = $2
       AND period_start = $3::date
       AND archived_at IS NULL AND superseded_at IS NULL
       AND EXISTS (SELECT 1 FROM audit_report_files arf WHERE arf.audit_report_id = audit_reports.id AND arf.format = 'pdf')
     ORDER BY generated_at DESC`,
    [monitoredAppId, periodType, toDateString(periodStart)],
  )
  return result.rows
}

export async function getReportByReportIdForApp(
  reportId: string,
  monitoredAppId: number,
): Promise<{ id: number; report_id: string; archived_at: Date | null } | null> {
  const result = await pool.query(
    `SELECT id, report_id, archived_at
     FROM audit_reports
     WHERE report_id = $1 AND monitored_app_id = $2`,
    [reportId, monitoredAppId],
  )
  return result.rows[0] || null
}

export async function getReportSummaryById(reportId: number): Promise<M2MAuditReportRow | null> {
  const result = await pool.query<M2MAuditReportRow>(
    `SELECT id, report_id, period_type, period_label, period_start, period_end,
            generated_at, generated_by, generated_by_app,
            total_deployments, pr_approved_count, manually_approved_count,
            change_origin_count, content_hash,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE id = $1`,
    [reportId],
  )
  return result.rows[0] || null
}
