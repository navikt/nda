import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildReportData, getAuditReportData } from '../../audit-reports.server'
import { resetVerificationStatus } from '../../deployments/status-history.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

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

const PERIOD_START = new Date('2026-01-01T00:00:00Z')
const PERIOD_END = new Date('2026-12-31T23:59:59Z')
const IN_PERIOD = new Date('2026-03-10T10:00:00Z')

describe('resetVerificationStatus', () => {
  it('updates status to unknown and inserts admin_reset history row', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'manually_approved',
    })

    await resetVerificationStatus(deploymentId, 'Z990001', 'PR fikset etter godkjenning', 'manually_approved')

    const { rows: deplRows } = await pool.query(`SELECT four_eyes_status FROM deployments WHERE id = $1`, [
      deploymentId,
    ])
    expect(deplRows[0].four_eyes_status).toBe('unknown')

    const { rows: histRows } = await pool.query(
      `SELECT from_status, to_status, changed_by, change_source, details
       FROM deployment_status_history
       WHERE deployment_id = $1 AND change_source = 'admin_reset'`,
      [deploymentId],
    )
    expect(histRows).toHaveLength(1)
    expect(histRows[0].from_status).toBe('manually_approved')
    expect(histRows[0].to_status).toBe('unknown')
    expect(histRows[0].changed_by).toBe('Z990001')
    expect(histRows[0].details.reason).toBe('PR fikset etter godkjenning')
  })

  it('throws and rolls back when status has changed (race condition guard)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'manually_approved',
    })

    await expect(resetVerificationStatus(deploymentId, 'Z990002', 'Begrunnelse', 'baseline')).rejects.toThrow()

    const { rows } = await pool.query(`SELECT four_eyes_status FROM deployments WHERE id = $1`, [deploymentId])
    expect(rows[0].four_eyes_status).toBe('manually_approved')

    const { rows: histRows } = await pool.query(
      `SELECT id FROM deployment_status_history WHERE deployment_id = $1 AND change_source = 'admin_reset'`,
      [deploymentId],
    )
    expect(histRows).toHaveLength(0)
  })
})

describe('getAuditReportData — admin_resets', () => {
  it('includes admin reset for deployment created in period', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-c', appName: 'app-c', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'unknown',
      githubPrData: { reviewers: [] },
    })

    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, details, created_at)
       VALUES ($1, 'manually_approved', 'unknown', 'Z990003', 'admin_reset', $2, $3)`,
      [deploymentId, JSON.stringify({ reason: 'Feil godkjenning' }), IN_PERIOD],
    )

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)
    const report = buildReportData(rawData)

    expect(report.admin_resets).toHaveLength(1)
    expect(report.admin_resets[0].deployment_id).toBe(deploymentId)
    expect(report.admin_resets[0].reason).toBe('Feil godkjenning')
    expect(report.admin_resets[0].reset_by).toBe('Z990003')
  })

  it('includes admin reset in period for deployment created before period', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-d', appName: 'app-d', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: new Date('2025-10-01T10:00:00Z'),
      fourEyesStatus: 'unknown',
      githubPrData: { reviewers: [] },
    })

    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, details, created_at)
       VALUES ($1, 'baseline', 'unknown', 'Z990004', 'admin_reset', $2, $3)`,
      [deploymentId, JSON.stringify({ reason: 'Tilbakestilling i perioden' }), IN_PERIOD],
    )

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)
    const report = buildReportData(rawData)

    expect(report.admin_resets).toHaveLength(1)
    expect(report.admin_resets[0].deployment_id).toBe(deploymentId)
    expect(report.admin_resets[0].reason).toBe('Tilbakestilling i perioden')
  })

  it('excludes admin reset outside report period', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-e', appName: 'app-e', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-e',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'unknown',
      githubPrData: { reviewers: [] },
    })

    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, details, created_at)
       VALUES ($1, 'manually_approved', 'unknown', 'Z990005', 'admin_reset', $2, $3)`,
      [deploymentId, JSON.stringify({ reason: 'Utenfor perioden' }), new Date('2025-06-01T10:00:00Z')],
    )

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)
    const report = buildReportData(rawData)

    expect(report.admin_resets).toHaveLength(0)
  })
})
