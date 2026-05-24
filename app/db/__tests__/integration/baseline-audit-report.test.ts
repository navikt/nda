/**
 * Integration tests for baseline deployment handling in audit report data.
 *
 * Verifies that:
 * - A deployment with four_eyes_status='baseline' gets method='baseline' in report data
 * - The approver is fetched from deployment_status_history (change_source='baseline_approval')
 * - baseline_count is correctly counted
 * - A baseline deployment with no status history row shows approver='-' (not PR reviewers)
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildReportData, getAuditReportData } from '../../audit-reports.server'
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

describe('baseline deployment in audit report', () => {
  it('maps a baseline deployment to method="baseline" with approver from status history', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
      title: 'Baseline deployment',
      githubPrData: {
        reviewers: [{ username: 'some-reviewer', state: 'APPROVED', submitted_at: '2026-03-10T09:00:00Z' }],
      },
    })

    // Seed the baseline approval in status history
    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, created_at)
       VALUES ($1, 'pending_baseline', 'baseline', 'Z990001', 'baseline_approval', $2)`,
      [deploymentId, IN_PERIOD],
    )

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)
    const report = buildReportData(rawData)

    expect(report.baseline_count).toBe(1)
    expect(report.deployments).toHaveLength(1)

    const entry = report.deployments[0]
    expect(entry.method).toBe('baseline')
    // Approver should come from status history (nav-ident), not from PR reviewers
    expect(entry.approver).toBe('Z990001')
  })

  it('throws when baseline deployment has no status history row', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-c', appName: 'app-c', environment: 'prod-gcp' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
      githubPrData: {
        reviewers: [{ username: 'some-reviewer', state: 'APPROVED', submitted_at: '2026-03-10T09:00:00Z' }],
      },
    })

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)

    // Generating a report for a baseline without an approver is invalid — must throw
    expect(() => buildReportData(rawData)).toThrow(/missing an approver/)
  })

  it('counts baseline_count correctly alongside pr deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-d', appName: 'app-d', environment: 'prod-gcp' })

    // One baseline
    const baselineId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, created_at)
       VALUES ($1, 'pending_baseline', 'baseline', 'Z990002', 'baseline_approval', $2)`,
      [baselineId, new Date('2026-02-01T11:00:00Z')],
    )

    // Two PR-approved deployments
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: new Date('2026-04-01T10:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer1', state: 'APPROVED', submitted_at: '2026-04-01T09:00:00Z' }],
      },
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: new Date('2026-06-01T10:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer2', state: 'APPROVED', submitted_at: '2026-06-01T09:00:00Z' }],
      },
    })

    const rawData = await getAuditReportData(appId, PERIOD_START, PERIOD_END)
    const report = buildReportData(rawData)

    expect(report.deployments).toHaveLength(3)
    expect(report.baseline_count).toBe(1)
    expect(report.deployments.filter((d) => d.method === 'pr')).toHaveLength(2)
  })
})
