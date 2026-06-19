/**
 * Integration tests for audit report superseding.
 *
 * Verifies that when a new report is generated for a period that already has
 * an active report, the old report is marked as superseded and the new one
 * becomes the active report.
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getAuditReportsForApp,
  getAuditReportsForAppAdmin,
  hasActiveReportForPeriod,
  saveAuditReport,
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
}

describe('audit report superseding', () => {
  it('marks old report as superseded when saving a new report for the same period', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-fss' })

    const periodStart = new Date('2025-01-01')
    const periodEnd = new Date('2025-12-31')

    // Create first report
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

    // Verify the period has an active report
    expect(await hasActiveReportForPeriod(appId, 'yearly', periodStart, periodEnd)).toBe(true)

    // Create second report for same period with supersede reason
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

    // Verify old report is superseded
    const { rows: allReports } = await pool.query(
      'SELECT id, superseded_at, superseded_by, supersede_reason, superseded_by_report_id FROM audit_reports WHERE id = $1',
      [report1.id],
    )
    expect(allReports[0].superseded_at).not.toBeNull()
    expect(allReports[0].superseded_by).toBe('S222222')
    expect(allReports[0].supersede_reason).toBe('Korrigert etter oppdaterte verifiseringsdata')
    expect(allReports[0].superseded_by_report_id).toBe(report2.id)

    // Verify new report is not superseded
    const { rows: newReport } = await pool.query('SELECT superseded_at FROM audit_reports WHERE id = $1', [report2.id])
    expect(newReport[0].superseded_at).toBeNull()

    // Verify only active report appears in public view
    const publicReports = await getAuditReportsForApp(appId)
    expect(publicReports).toHaveLength(1)
    expect(publicReports[0].id).toBe(report2.id)

    // Verify both appear in admin view
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

    // Create yearly report
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

    // Create tertiary report for same start date — should NOT supersede the yearly
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

    // Both should be active
    const { rows } = await pool.query(
      'SELECT id, period_type, superseded_at FROM audit_reports WHERE monitored_app_id = $1 ORDER BY id',
      [appId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].superseded_at).toBeNull()
    expect(rows[1].superseded_at).toBeNull()
  })
})
