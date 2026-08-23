import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { toDateString } from '~/lib/date-utils'
import { isDependabotUser } from '~/lib/dependabot'
import type { ReportPeriodType } from '~/lib/report-periods'
import { generateReportId } from '~/lib/report-periods'
import { pool } from '../../connection.server'
import type { AuditReport } from '../admin-retrieval.server'
import type { AuditReportData } from './types'

function calculateReportHash(reportData: AuditReportData): string {
  const json = JSON.stringify(reportData)
  return createHash('sha256').update(json).digest('hex')
}

export async function saveAuditReport(params: {
  monitoredAppId: number
  appName: string
  teamSlug: string
  environmentName: string
  repository: string
  year: number
  periodType: ReportPeriodType
  periodLabel: string
  periodStart: Date
  periodEnd: Date
  reportData: AuditReportData
  generatedBy?: string
  generatedByApp?: string
  supersedeReason?: string
}): Promise<AuditReport> {
  const {
    monitoredAppId,
    appName,
    teamSlug,
    environmentName,
    repository,
    year,
    periodType,
    periodLabel,
    periodStart,
    periodEnd,
    reportData,
    generatedBy,
    generatedByApp,
    supersedeReason,
  } = params

  const contentHash = calculateReportHash(reportData)
  const reportId = generateReportId(periodType, periodLabel, appName, environmentName, contentHash)

  const prApprovedCount = reportData.deployments.filter((d) => d.method === 'pr').length
  const manuallyApprovedCount = reportData.deployments.filter((d) => d.method === 'manual').length

  const changeOriginCount = reportData.deployments.filter(
    (d) => d.goal_links && d.goal_links.length > 0 && !isDependabotUser(d.pr_author),
  ).length

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const supersededIds = await supersedeExistingReports(
      client,
      monitoredAppId,
      periodType,
      periodStart,
      periodEnd,
      generatedBy ?? generatedByApp,
      supersedeReason,
    )

    if (supersededIds.length > 0 && !supersedeReason) {
      throw new Error('An active report already exists for this period. You must provide a reason to supersede it.')
    }

    const result = await client.query<AuditReport>(
      `INSERT INTO audit_reports (
        report_id, monitored_app_id, app_name, team_slug, environment_name, repository,
        year, period_type, period_label, period_start, period_end,
        total_deployments, pr_approved_count, manually_approved_count,
        unique_deployers, unique_reviewers,
        report_data, content_hash, generated_by, generated_by_app, change_origin_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *`,
      [
        reportId,
        monitoredAppId,
        appName,
        teamSlug,
        environmentName,
        repository,
        year,
        periodType,
        periodLabel,
        toDateString(periodStart),
        toDateString(periodEnd),
        reportData.deployments.length,
        prApprovedCount,
        manuallyApprovedCount,
        reportData.contributors.length,
        reportData.reviewers.length,
        JSON.stringify(reportData),
        contentHash,
        generatedBy || null,
        generatedByApp || null,
        changeOriginCount,
      ],
    )

    const newReport = result.rows[0]

    if (supersededIds.length > 0) {
      await client.query(`UPDATE audit_reports SET superseded_by_report_id = $1 WHERE id = ANY($2)`, [
        newReport.id,
        supersededIds,
      ])
    }

    await client.query('COMMIT')
    return newReport
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function supersedeExistingReports(
  client: PoolClient,
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
  periodEnd: Date,
  supersededBy?: string,
  supersedeReason?: string,
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE audit_reports
     SET superseded_at = NOW(),
         superseded_by = $1,
         supersede_reason = $2
     WHERE monitored_app_id = $3
       AND period_type = $4
       AND period_start = $5::date
       AND period_end = $6::date
       AND superseded_at IS NULL
       AND archived_at IS NULL
     RETURNING id`,
    [
      supersededBy || null,
      supersedeReason || null,
      monitoredAppId,
      periodType,
      toDateString(periodStart),
      toDateString(periodEnd),
    ],
  )
  return result.rows.map((r) => r.id)
}
