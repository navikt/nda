import type { ReportPeriodType } from '~/lib/report-periods'
import type { AuditReportData } from '../audit-reports.server'
import { pool } from '../connection.server'

export interface AuditReport {
  id: number
  report_id: string
  monitored_app_id: number
  app_name: string
  team_slug: string
  environment_name: string
  repository: string
  year: number
  period_type: ReportPeriodType
  period_label: string
  period_start: Date
  period_end: Date
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  unique_deployers: number
  unique_reviewers: number
  report_data: AuditReportData
  content_hash: string
  generated_at: Date
  generated_by: string | null
  generated_by_app: string | null
  change_origin_count: number | null
  superseded_at: Date | null
  superseded_by: string | null
  supersede_reason: string | null
  superseded_by_report_id: number | null
}

export interface AuditReportSummary {
  id: number
  report_id: string
  app_name: string
  team_slug: string
  environment_name: string
  year: number
  period_type: ReportPeriodType
  period_label: string
  period_start: Date
  period_end: Date
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  generated_at: Date
  archived_at: Date | null
  archived_by: string | null
  archive_reason: string | null
  superseded_at: Date | null
  superseded_by: string | null
  supersede_reason: string | null
  superseded_by_report_id: number | null
  formats: string[]
}

export async function getAuditReportById(id: number): Promise<AuditReport | null> {
  const result = await pool.query<AuditReport>('SELECT * FROM audit_reports WHERE id = $1', [id])
  return result.rows[0] || null
}

export async function getAllAuditReports(): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label, period_start, period_end,
            total_deployments, pr_approved_count, manually_approved_count, generated_at,
            archived_at, archived_by, archive_reason,
            superseded_at, superseded_by, supersede_reason, superseded_by_report_id,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     ORDER BY generated_at DESC`,
  )
  return result.rows
}

export async function getAuditReportsForApp(monitoredAppId: number): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label, period_start, period_end,
            total_deployments, pr_approved_count, manually_approved_count, generated_at,
            archived_at, archived_by, archive_reason,
            superseded_at, superseded_by, supersede_reason, superseded_by_report_id,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1 AND archived_at IS NULL AND superseded_at IS NULL
     ORDER BY year DESC, period_start DESC`,
    [monitoredAppId],
  )
  return result.rows
}

export async function getAuditReportsForAppAdmin(monitoredAppId: number): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label, period_start, period_end,
            total_deployments, pr_approved_count, manually_approved_count, generated_at,
            archived_at, archived_by, archive_reason,
            superseded_at, superseded_by, supersede_reason, superseded_by_report_id,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1
     ORDER BY year DESC, period_start DESC`,
    [monitoredAppId],
  )
  return result.rows
}
