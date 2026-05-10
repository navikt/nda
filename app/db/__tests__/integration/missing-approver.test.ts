/**
 * Integration tests for missing-approver detection in audit readiness
 * and verification diff queries.
 *
 * Covers:
 * - Approved deployment with no reviewers and no manual approval → blocked
 * - Approved deployment with APPROVED reviewer → passes
 * - Approved deployment with manual_approval comment → passes
 * - Excluded statuses (no_changes, baseline, implicitly_approved) → not blocked
 * - getApprovedDeploymentsMissingApprover query (per-app)
 * - getAllApprovedDeploymentsMissingApprover query (global, cross-app)
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { checkAuditReadiness } from '../../audit-reports.server'
import {
  getAllApprovedDeploymentsMissingApprover,
  getApprovedDeploymentsMissingApprover,
} from '../../verification-diff.server'
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
const IN_PERIOD = new Date('2026-06-15T10:00:00Z')

describe('missing approver detection — checkAuditReadiness', () => {
  it('blocks when approved deployment has no reviewers and no manual approval', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod-gcp',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved_pr',
      githubPrData: { reviewers: [] },
    })

    const result = await checkAuditReadiness(appId, PERIOD_START, PERIOD_END)
    expect(result.is_ready).toBe(false)
    expect(result.missing_approver_count).toBe(1)
    expect(result.missing_approver_deployments).toHaveLength(1)
  })

  it('passes when approved deployment has APPROVED reviewer', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod-gcp',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer1', state: 'APPROVED', submitted_at: '2026-06-15T09:00:00Z' }],
      },
    })

    const result = await checkAuditReadiness(appId, PERIOD_START, PERIOD_END)
    expect(result.is_ready).toBe(true)
    expect(result.missing_approver_count).toBe(0)
  })

  it('passes when approved deployment has manual_approval comment', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod-gcp',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'manually_approved',
      githubPrData: { reviewers: [] },
    })

    // Insert manual approval comment
    await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_type, comment_text, approved_by)
       VALUES ($1, 'manual_approval', 'Godkjent manuelt', 'admin-user')`,
      [deploymentId],
    )

    const result = await checkAuditReadiness(appId, PERIOD_START, PERIOD_END)
    expect(result.is_ready).toBe(true)
    expect(result.missing_approver_count).toBe(0)
  })

  it('does not flag no_changes, baseline, or implicitly_approved', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod-gcp',
    })

    for (const status of ['no_changes', 'baseline', 'implicitly_approved']) {
      await seedDeployment(pool, {
        monitoredAppId: appId,
        teamSlug: 'team-a',
        environment: 'prod-gcp',
        createdAt: IN_PERIOD,
        fourEyesStatus: status,
        githubPrData: { reviewers: [] },
      })
    }

    const result = await checkAuditReadiness(appId, PERIOD_START, PERIOD_END)
    expect(result.is_ready).toBe(true)
    expect(result.missing_approver_count).toBe(0)
  })
})

describe('missing approver detection — getApprovedDeploymentsMissingApprover', () => {
  it('returns approved deployment with no reviewers', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubPrData: { reviewers: [] },
    })

    const result = await getApprovedDeploymentsMissingApprover(appId)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(deploymentId)
  })

  it('excludes deployment with APPROVED reviewer', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer1', state: 'APPROVED', submitted_at: '2026-06-15T09:00:00Z' }],
      },
    })

    const result = await getApprovedDeploymentsMissingApprover(appId)
    expect(result).toHaveLength(0)
  })

  it('excludes implicitly_approved status', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'implicitly_approved',
      githubPrData: { reviewers: [] },
    })

    const result = await getApprovedDeploymentsMissingApprover(appId)
    expect(result).toHaveLength(0)
  })

  it('flags deployment when manual_approval comment is soft-deleted', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'manually_approved',
      githubPrData: { reviewers: [] },
    })

    // Insert soft-deleted manual approval — should NOT count
    await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_type, comment_text, approved_by, deleted_at)
       VALUES ($1, 'manual_approval', 'Slettet godkjenning', 'admin-user', NOW())`,
      [deploymentId],
    )

    const result = await getApprovedDeploymentsMissingApprover(appId)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(deploymentId)
  })
})

describe('missing approver detection — getAllApprovedDeploymentsMissingApprover (global)', () => {
  it('returns missing-approver deployments across multiple apps', async () => {
    const appId1 = await seedApp(pool, { teamSlug: 'team-x', appName: 'app-x', environment: 'prod' })
    const appId2 = await seedApp(pool, { teamSlug: 'team-y', appName: 'app-y', environment: 'prod' })

    const dep1 = await seedDeployment(pool, {
      monitoredAppId: appId1,
      teamSlug: 'team-x',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubPrData: { reviewers: [] },
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: appId2,
      teamSlug: 'team-y',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved_pr',
      githubPrData: { reviewers: [] },
    })

    const result = await getAllApprovedDeploymentsMissingApprover()
    const ids = result.map((r) => r.id)
    expect(ids).toContain(dep1)
    expect(ids).toContain(dep2)
    expect(result.find((r) => r.id === dep1)?.team_slug).toBe('team-x')
    expect(result.find((r) => r.id === dep2)?.team_slug).toBe('team-y')
  })

  it('excludes deployments with APPROVED reviewer', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-z', appName: 'app-z', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-z',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved_pr',
      githubPrData: {
        reviewers: [{ username: 'reviewer1', state: 'APPROVED', submitted_at: '2026-06-15T09:00:00Z' }],
      },
    })

    const result = await getAllApprovedDeploymentsMissingApprover()
    expect(result.filter((r) => r.team_slug === 'team-z')).toHaveLength(0)
  })

  it('returns team_slug and app_name fields', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-meta', appName: 'app-meta', environment: 'prod' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-meta',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubPrData: { reviewers: [] },
    })

    const result = await getAllApprovedDeploymentsMissingApprover()
    const match = result.find((r) => r.team_slug === 'team-meta')
    expect(match).toBeDefined()
    expect(match?.app_name).toBe('app-meta')
  })
})
