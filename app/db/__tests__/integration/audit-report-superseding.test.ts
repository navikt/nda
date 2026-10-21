import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  archiveAuditReport,
  getActiveReportsForAppM2M,
  getActiveReportsForPeriodM2M,
  getAllAuditReports,
  getAuditReportsForApp,
  getAuditReportsForAppAdmin,
  getReportByReportIdForApp,
  getReportSummaryById,
  hasActiveReportForPeriod,
  saveAuditReport,
  saveAuditReportFile,
} from '../../audit-reports.server'
import { seedApp, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

const minimalReportData = {
  deployments: [],
  manual_approvals: [],
  contributors: [],
  reviewers: [],
  legacy_count: 0,
  deviations: [],
  unverified_commit_deployments: [],
  show_unverified_commits_note: false,
  admin_resets: [],
}

describe('audit report superseding', () => {
  it('keeps repository reports separate from application report replacement and retrieval', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-fss' })
    const periodStart = new Date('2025-01-01')
    const periodEnd = new Date('2025-12-31')
    const params = {
      monitoredAppId: appId,
      appName: 'app-a',
      teamSlug: 'team-a',
      environmentName: 'prod-fss',
      repository: 'navikt/app-a',
      year: 2025,
      periodType: 'yearly' as const,
      periodLabel: 'Årsrapport 2025',
      periodStart,
      periodEnd,
      reportData: minimalReportData,
      generatedBy: 'Z990001',
    }
    const original = await saveAuditReport(params)
    expect(original.assessment_model).toBe('application')
    expect(await hasActiveReportForPeriod(appId, 'yearly', periodStart, periodEnd, 'repository')).toBe(false)

    const { rows: repositoryReports } = await pool.query<{ id: number; report_id: string }>(
      `INSERT INTO audit_reports (
         report_id, monitored_app_id, app_name, team_slug, environment_name, repository,
         year, period_type, period_label, period_start, period_end,
         total_deployments, pr_approved_count, manually_approved_count, unique_deployers, unique_reviewers,
         report_data, content_hash, assessment_model
       )
       SELECT 'repository-report', monitored_app_id, app_name, team_slug, environment_name, repository,
              year, period_type, period_label, period_start, period_end,
              0, 0, 0, 0, 0, '{}', 'repository-hash', 'repository'
       FROM audit_reports WHERE id = $1
       RETURNING id, report_id`,
      [original.id],
    )
    const repositoryReport = repositoryReports[0]
    await saveAuditReportFile(repositoryReport.id, 'pdf', Buffer.from('repository-pdf'))
    await saveAuditReportFile(original.id, 'pdf', Buffer.from('original-pdf'))

    expect(await hasActiveReportForPeriod(appId, 'yearly', periodStart, periodEnd, 'repository')).toBe(true)
    expect((await getAuditReportsForApp(appId)).map((r) => r.id)).toEqual([original.id])
    expect((await getAuditReportsForApp(appId, 'repository')).map((r) => r.id)).toEqual([repositoryReport.id])
    expect((await getAuditReportsForAppAdmin(appId)).map((r) => r.id)).toEqual([original.id])
    expect((await getAllAuditReports()).map((r) => r.id)).toEqual([original.id])
    expect((await getAllAuditReports('repository')).map((r) => r.id)).toEqual([repositoryReport.id])
    expect((await getActiveReportsForAppM2M(appId)).map((r) => r.id)).toEqual([original.id])
    expect((await getActiveReportsForPeriodM2M(appId, 'yearly', periodStart)).map((r) => r.id)).toEqual([original.id])
    expect((await getActiveReportsForAppM2M(appId, 'repository')).map((r) => r.id)).toEqual([repositoryReport.id])
    expect((await getActiveReportsForPeriodM2M(appId, 'yearly', periodStart, 'repository')).map((r) => r.id)).toEqual([
      repositoryReport.id,
    ])
    expect(await getReportByReportIdForApp(repositoryReport.report_id, appId)).toBeNull()
    expect(await getReportByReportIdForApp(repositoryReport.report_id, appId, 'repository')).toMatchObject({
      id: repositoryReport.id,
    })
    expect(await getReportSummaryById(repositoryReport.id)).toBeNull()
    expect(await getReportSummaryById(repositoryReport.id, 'repository')).toMatchObject({
      assessment_model: 'repository',
    })

    await expect(saveAuditReport(params)).rejects.toThrow('An active report already exists')
    const replacement = await saveAuditReport({ ...params, supersedeReason: 'Oppdatert grunnlag' })
    const { rows } = await pool.query(
      `SELECT id, assessment_model, superseded_at, superseded_by_report_id, report_data, content_hash
       FROM audit_reports WHERE monitored_app_id = $1 ORDER BY id`,
      [appId],
    )
    expect(rows[0]).toMatchObject({
      superseded_by_report_id: replacement.id,
      report_data: original.report_data,
      content_hash: original.content_hash,
    })
    expect(rows[1]).toMatchObject({
      id: repositoryReport.id,
      assessment_model: 'repository',
      superseded_at: null,
      superseded_by_report_id: null,
      report_data: {},
      content_hash: 'repository-hash',
    })
    expect((await getAuditReportsForAppAdmin(appId, 'repository')).map((r) => r.id)).toEqual([repositoryReport.id])
    expect(await archiveAuditReport(repositoryReport.id, appId, 'Z990001', 'Arkiverer rapport')).toBe(true)
    expect(await getAuditReportsForApp(appId, 'repository')).toEqual([])
    expect(await getActiveReportsForAppM2M(appId, 'repository')).toEqual([])
    expect(await getActiveReportsForPeriodM2M(appId, 'yearly', periodStart, 'repository')).toEqual([])
  })

  it('marks old report as superseded when saving a new report for the same period', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-fss' })

    const periodStart = new Date('2025-01-01')
    const periodEnd = new Date('2025-12-31')

    const report1 = await saveAuditReport({
      monitoredAppId: appId,
      appName: 'app-a',
      teamSlug: 'team-a',
      environmentName: 'prod-fss',
      repository: 'navikt/app-a',
      year: 2025,
      periodType: 'yearly',
      periodLabel: 'Årsrapport 2025',
      periodStart,
      periodEnd,
      reportData: minimalReportData,
      generatedBy: 'S111111',
    })

    expect(report1.id).toBeDefined()

    expect(await hasActiveReportForPeriod(appId, 'yearly', periodStart, periodEnd)).toBe(true)

    const report2 = await saveAuditReport({
      monitoredAppId: appId,
      appName: 'app-a',
      teamSlug: 'team-a',
      environmentName: 'prod-fss',
      repository: 'navikt/app-a',
      year: 2025,
      periodType: 'yearly',
      periodLabel: 'Årsrapport 2025',
      periodStart,
      periodEnd,
      reportData: minimalReportData,
      generatedBy: 'S222222',
      supersedeReason: 'Korrigert etter oppdaterte verifiseringsdata',
    })

    expect(report2.id).not.toBe(report1.id)

    const { rows: allReports } = await pool.query(
      'SELECT id, superseded_at, superseded_by, supersede_reason, superseded_by_report_id FROM audit_reports WHERE id = $1',
      [report1.id],
    )
    expect(allReports[0].superseded_at).not.toBeNull()
    expect(allReports[0].superseded_by).toBe('S222222')
    expect(allReports[0].supersede_reason).toBe('Korrigert etter oppdaterte verifiseringsdata')
    expect(allReports[0].superseded_by_report_id).toBe(report2.id)

    const { rows: newReport } = await pool.query('SELECT superseded_at FROM audit_reports WHERE id = $1', [report2.id])
    expect(newReport[0].superseded_at).toBeNull()

    const publicReports = await getAuditReportsForApp(appId)
    expect(publicReports).toHaveLength(1)
    expect(publicReports[0].id).toBe(report2.id)

    const adminReports = await getAuditReportsForAppAdmin(appId)
    expect(adminReports).toHaveLength(2)
  })

  it('hasActiveReportForPeriod returns false when no report exists', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-fss' })
    expect(await hasActiveReportForPeriod(appId, 'yearly', new Date('2025-01-01'), new Date('2025-12-31'))).toBe(false)
  })

  it('does not supersede reports from different period types', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-c', appName: 'app-c', environment: 'prod-fss' })

    const periodStart = new Date('2025-01-01')

    await saveAuditReport({
      monitoredAppId: appId,
      appName: 'app-c',
      teamSlug: 'team-c',
      environmentName: 'prod-fss',
      repository: 'navikt/app-c',
      year: 2025,
      periodType: 'yearly',
      periodLabel: 'Årsrapport 2025',
      periodStart,
      periodEnd: new Date('2025-12-31'),
      reportData: minimalReportData,
      generatedBy: 'S111111',
    })

    await saveAuditReport({
      monitoredAppId: appId,
      appName: 'app-c',
      teamSlug: 'team-c',
      environmentName: 'prod-fss',
      repository: 'navikt/app-c',
      year: 2025,
      periodType: 'tertiary',
      periodLabel: 'T1 2025',
      periodStart,
      periodEnd: new Date('2025-04-30'),
      reportData: minimalReportData,
      generatedBy: 'S222222',
    })

    const { rows } = await pool.query(
      'SELECT id, period_type, superseded_at FROM audit_reports WHERE monitored_app_id = $1 ORDER BY id',
      [appId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].superseded_at).toBeNull()
    expect(rows[1].superseded_at).toBeNull()
  })
})
