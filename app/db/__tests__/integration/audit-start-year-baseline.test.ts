import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  applyAuditStartYearChange,
  reconcileAuditStartYearOnRepoActivation,
} from '../../audit-start-year-baseline.server'
import { seedApp, seedApplicationRepository, seedDeployment, truncateAllTables } from './helpers'

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

async function getStatus(deploymentId: number): Promise<string> {
  const { rows } = await pool.query<{ four_eyes_status: string }>(
    `SELECT four_eyes_status FROM deployments WHERE id = $1`,
    [deploymentId],
  )
  return rows[0].four_eyes_status
}

async function getAuditStartYear(appId: number): Promise<number | null> {
  const { rows } = await pool.query<{ audit_start_year: number | null }>(
    `SELECT audit_start_year FROM monitored_applications WHERE id = $1`,
    [appId],
  )
  return rows[0].audit_start_year
}

describe('applyAuditStartYearChange', () => {
  it('proposes the first deployment of the new year as baseline when none existed before', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: null,
    })
    const before = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const firstInYear = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(firstInYear)
    expect(result.demotedDeploymentIds).toEqual([])
    expect(await getStatus(firstInYear)).toBe('pending_baseline')
    expect(await getStatus(before)).toBe('approved_pr')
    expect(await getAuditStartYear(appId)).toBe(2026)
  })

  it('does not promote a deployment with an unauthorized_repository or unauthorized_branch status to pending_baseline', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a2',
      appName: 'app-a2',
      environment: 'prod',
      auditStartYear: null,
    })
    const unauthorizedRepo = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a2',
      environment: 'prod',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'unauthorized_repository',
    })
    const unauthorizedBranch = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a2',
      environment: 'prod',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'unauthorized_branch',
    })
    const firstEligibleInYear = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a2',
      environment: 'prod',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(firstEligibleInYear)
    expect(await getStatus(unauthorizedRepo)).toBe('unauthorized_repository')
    expect(await getStatus(unauthorizedBranch)).toBe('unauthorized_branch')
    expect(await getStatus(firstEligibleInYear)).toBe('pending_baseline')
  })

  it('is a no-op when the current baseline marker is already the correct first deployment', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const baseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBeNull()
    expect(result.demotedDeploymentIds).toEqual([])
    expect(await getStatus(baseline)).toBe('baseline')
  })

  it('demotes an approved baseline to manually_approved and promotes the new first deployment when the year moves earlier', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-c',
      appName: 'app-c',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const oldBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentIds).toEqual([oldBaseline])
    expect(await getStatus(earlierDeploy)).toBe('pending_baseline')
    expect(await getStatus(oldBaseline)).toBe('manually_approved')

    const { rows } = await pool.query(
      `SELECT from_status, to_status, changed_by, change_source FROM deployment_status_history
       WHERE deployment_id = $1 ORDER BY id`,
      [oldBaseline],
    )
    expect(rows).toEqual([
      expect.objectContaining({
        from_status: 'baseline',
        to_status: 'manually_approved',
        changed_by: 'Z990001',
        change_source: 'audit_start_year_change',
      }),
    ])
  })

  it('demotes every stale marker when the app has more than one deployment marked baseline/pending_baseline', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-c2',
      appName: 'app-c2',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c2',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const staleBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c2',
      environment: 'prod',
      createdAt: new Date('2025-06-05T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    const stalePendingBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c2',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentIds.sort()).toEqual([staleBaseline, stalePendingBaseline].sort())
    expect(await getStatus(earlierDeploy)).toBe('pending_baseline')
    expect(await getStatus(staleBaseline)).toBe('manually_approved')
    expect(await getStatus(stalePendingBaseline)).toBe('pending')
  })

  it('sends an unapproved pending_baseline marker back to normal verification when it is no longer first', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-d',
      appName: 'app-d',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const earlierDeploy = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
    })
    const oldPendingBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2025, 'Z990001')

    expect(result.promotedDeploymentId).toBe(earlierDeploy)
    expect(result.demotedDeploymentIds).toEqual([oldPendingBaseline])
    expect(await getStatus(earlierDeploy)).toBe('pending_baseline')
    expect(await getStatus(oldPendingBaseline)).toBe('pending')
  })

  it('demotes the old marker and leaves no promotion when no deployment exists in the new scope', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-e',
      appName: 'app-e',
      environment: 'prod',
      auditStartYear: 2025,
    })
    const oldPendingBaseline = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-e',
      environment: 'prod',
      createdAt: new Date('2025-03-01T00:00:00Z'),
      fourEyesStatus: 'pending_baseline',
    })

    const result = await applyAuditStartYearChange(appId, 2030, 'Z990001')

    expect(result.promotedDeploymentId).toBeNull()
    expect(result.demotedDeploymentIds).toEqual([oldPendingBaseline])
    expect(await getStatus(oldPendingBaseline)).toBe('pending')
  })

  it('cascades the new year to repo siblings and recomputes baseline across the repo', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-f',
      appName: 'app-f-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-f',
      appName: 'app-f-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '901',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '901',
    })

    const beforeYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-f',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })
    const firstInYearSibling = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-f',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds.sort()).toEqual([appA, appB].sort())
    expect(result.promotedDeploymentId).toBe(firstInYearSibling)
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBe(2026)
    expect(await getStatus(firstInYearSibling)).toBe('pending_baseline')
    expect(await getStatus(beforeYear)).toBe('approved_pr')
  })

  it('recomputes baseline for the whole repo scope', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g',
      appName: 'app-g-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g',
      appName: 'app-g-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '902',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
      githubRepoId: '902',
    })

    const appAFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g',
      environment: 'prod-fss',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })
    const appBEarlierInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-g',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(appBEarlierInYear)
    expect(await getStatus(appBEarlierInYear)).toBe('pending_baseline')
    expect(await getStatus(appAFirstInYear)).toBe('approved_pr')
  })

  it('demotes an old baseline marker with unknown (NULL) detected repo even when a repo scope is known', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g2',
      appName: 'app-g2-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g2',
      appName: 'app-g2-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-2',
      githubRepoId: '903',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-2',
      githubRepoId: '903',
    })

    const oldBaselineWithUnknownRepo = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g2',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
    })
    const newFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-g2',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app-2',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([oldBaselineWithUnknownRepo])
    expect(result.promotedDeploymentId).toBe(newFirstInYear)
    expect(await getStatus(oldBaselineWithUnknownRepo)).toBe('manually_approved')
    expect(await getStatus(newFirstInYear)).toBe('pending_baseline')
  })

  it('does not treat a marker with only a partially unknown detected repo as in-scope for demotion', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g2b',
      appName: 'app-g2b-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-g2b',
      appName: 'app-g2b-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-3',
      githubRepoId: '904',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-app-3',
      githubRepoId: '904',
    })

    const partiallyUnknownBaseline = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g2b',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'other-repo',
    })
    await pool.query(`UPDATE deployments SET detected_github_repo_name = NULL WHERE id = $1`, [
      partiallyUnknownBaseline,
    ])

    const newFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-g2b',
      environment: 'prod-gcp',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-app-3',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([])
    expect(result.promotedDeploymentId).toBe(newFirstInYear)
    expect(await getStatus(partiallyUnknownBaseline)).toBe('baseline')
    expect(await getStatus(newFirstInYear)).toBe('pending_baseline')
  })

  it('skips baseline recompute entirely when the acting app has more than one distinct active repo (ambiguous scope)', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-g3',
      appName: 'app-g3-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: 'navikt', githubRepo: 'repo-one' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: 'navikt', githubRepo: 'repo-two' })

    const appABaseline = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g3',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'repo-one',
    })
    const appAFirstInYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-g3',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'repo-one',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.recomputeSkippedDueToAmbiguousRepoScope).toBe(true)
    expect(result.demotedDeploymentIds).toEqual([])
    expect(result.promotedDeploymentId).toBeNull()
    expect(await getStatus(appABaseline)).toBe('baseline')
    expect(await getStatus(appAFirstInYear)).toBe('approved_pr')
    expect(await getAuditStartYear(appA)).toBe(2026)
  })

  it('cascades the new year to a monorepo sibling sharing the same github_repo_id, without any application group', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-mono',
      appName: 'app-mono-backend',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono',
      appName: 'app-mono-frontend',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '555',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '555',
    })

    const beforeYear = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-mono',
      environment: 'prod-gcp',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const firstInYearSibling = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-mono',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds.sort()).toEqual([appA, appB].sort())
    expect(result.promotedDeploymentId).toBe(firstInYearSibling)
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBe(2026)
    expect(await getStatus(firstInYearSibling)).toBe('pending_baseline')
    expect(await getStatus(beforeYear)).toBe('approved_pr')
  })

  it('does not cascade to another app in the same owner/repo string if github_repo_id differs', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-mono2',
      appName: 'app-mono2-a',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono2',
      appName: 'app-mono2-b',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'ambiguous-repo',
      githubRepoId: '111',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'ambiguous-repo',
      githubRepoId: '222',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds).toEqual([appA])
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBeNull()
  })

  it('does not cascade to a monorepo sibling that is inactive', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-mono3',
      appName: 'app-mono3-active',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-mono3',
      appName: 'app-mono3-inactive',
      environment: 'prod-gcp',
      auditStartYear: null,
      isActive: false,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-with-inactive',
      githubRepoId: '777',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-with-inactive',
      githubRepoId: '777',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.updatedAppIds).toEqual([appA])
    expect(await getAuditStartYear(appA)).toBe(2026)
    expect(await getAuditStartYear(appB)).toBeNull()
  })

  it('still recomputes baseline for a sibling app when the acting app itself has no deployments yet', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-h',
      appName: 'app-h-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-h',
      appName: 'app-h-2',
      environment: 'prod-gcp',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-b',
      githubRepoId: '905',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'repo-b',
      githubRepoId: '905',
    })

    const siblingDeploy = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-h',
      environment: 'prod-gcp',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'repo-b',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.promotedDeploymentId).toBe(siblingDeploy)
    expect(await getStatus(siblingDeploy)).toBe('pending_baseline')
  })

  it('logs each app’s own previous audit_start_year in status history, not the acting app’s', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-hi',
      appName: 'app-hi-1',
      environment: 'prod-fss',
      auditStartYear: 2024,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-hi',
      appName: 'app-hi-2',
      environment: 'prod-gcp',
      auditStartYear: 2023,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
      githubRepoId: '906',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
      githubRepoId: '906',
    })

    const groupOldBaseline = await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-hi',
      environment: 'prod-gcp',
      createdAt: new Date('2023-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
    })
    const appANewFirst = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-hi',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'shared-hi',
    })

    const result = await applyAuditStartYearChange(appA, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([groupOldBaseline])
    expect(result.promotedDeploymentId).toBe(appANewFirst)

    const { rows: demotedRows } = await pool.query<{ details: { previous_audit_start_year: number | null } }>(
      `SELECT details FROM deployment_status_history WHERE deployment_id = $1 ORDER BY id`,
      [groupOldBaseline],
    )
    const { rows: promotedRows } = await pool.query<{ details: { previous_audit_start_year: number | null } }>(
      `SELECT details FROM deployment_status_history WHERE deployment_id = $1 ORDER BY id`,
      [appANewFirst],
    )

    expect(demotedRows[0]?.details.previous_audit_start_year).toBe(2023)
    expect(promotedRows[0]?.details.previous_audit_start_year).toBe(2024)
  })

  it('demotes an existing baseline marker even when it has no commit_sha', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-i',
      appName: 'app-i-1',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: 'navikt', githubRepo: 'repo-i' })

    const oldBaselineNoCommit = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-i',
      environment: 'prod-fss',
      createdAt: new Date('2025-06-01T00:00:00Z'),
      fourEyesStatus: 'baseline',
      commitSha: null,
      githubOwner: 'navikt',
      githubRepo: 'repo-i',
    })
    const firstInYear = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-i',
      environment: 'prod-fss',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      fourEyesStatus: 'approved_pr',
      githubOwner: 'navikt',
      githubRepo: 'repo-i',
    })

    const result = await applyAuditStartYearChange(appId, 2026, 'Z990001')

    expect(result.demotedDeploymentIds).toEqual([oldBaselineNoCommit])
    expect(await getStatus(oldBaselineNoCommit)).toBe('manually_approved')
    expect(result.promotedDeploymentId).toBe(firstInYear)
    expect(await getStatus(firstInYear)).toBe('pending_baseline')
  })
})

describe('reconcileAuditStartYearOnRepoActivation', () => {
  it('does nothing when the app has no active-repo siblings', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-1',
      environment: 'prod-fss',
      auditStartYear: 2024,
    })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: 'navikt', githubRepo: 'repo-j' })

    await reconcileAuditStartYearOnRepoActivation(appId, true)

    expect(await getAuditStartYear(appId)).toBe(2024)
  })

  it('does nothing when the active repo is unchanged, even if the app has no explicit value and siblings differ', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-1b',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-1c',
      environment: 'prod-fss',
      auditStartYear: 2023,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-j2',
      githubRepoId: '905',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-j2',
      githubRepoId: '905',
    })

    await reconcileAuditStartYearOnRepoActivation(appA, false)

    expect(await getAuditStartYear(appA)).toBeNull()
    expect(await getAuditStartYear(appB)).toBe(2023)
  })

  it('respects an existing explicit value when the app already had this active repo before', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-2',
      environment: 'prod-fss',
      auditStartYear: 2024,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-3',
      environment: 'prod-fss',
      auditStartYear: 2022,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-j',
      githubRepoId: '900',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-j',
      githubRepoId: '900',
    })

    await reconcileAuditStartYearOnRepoActivation(appA, false)

    expect(await getAuditStartYear(appA)).toBe(2024)
    expect(await getAuditStartYear(appB)).toBe(2022)
  })

  it('adopts the resolved sibling value when the app joins a monorepo for the first time', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-4',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-5',
      environment: 'prod-fss',
      auditStartYear: 2023,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-k',
      githubRepoId: '901',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-k',
      githubRepoId: '901',
    })

    await reconcileAuditStartYearOnRepoActivation(appA, true)

    expect(await getAuditStartYear(appA)).toBe(2023)
    expect(await getAuditStartYear(appB)).toBe(2023)
  })

  it('re-aligns to the resolved sibling value when the app switches to a different active repo', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-6',
      environment: 'prod-fss',
      auditStartYear: 2024,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-7',
      environment: 'prod-fss',
      auditStartYear: 2021,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-l',
      githubRepoId: '902',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-l',
      githubRepoId: '902',
    })

    await reconcileAuditStartYearOnRepoActivation(appA, true)

    expect(await getAuditStartYear(appA)).toBe(2021)
    expect(await getAuditStartYear(appB)).toBe(2021)
  })

  it('resolves to null when any sibling has no explicit audit_start_year', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-8',
      environment: 'prod-fss',
      auditStartYear: 2024,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-9',
      environment: 'prod-fss',
      auditStartYear: null,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-m',
      githubRepoId: '903',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-m',
      githubRepoId: '903',
    })

    await reconcileAuditStartYearOnRepoActivation(appA, true)

    expect(await getAuditStartYear(appA)).toBeNull()
    expect(await getAuditStartYear(appB)).toBeNull()
  })

  it('still fixes a mismatched sibling even when the acting app already has the resolved value', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-10',
      environment: 'prod-fss',
      auditStartYear: 2021,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-11',
      environment: 'prod-fss',
      auditStartYear: 2021,
    })
    const appC = await seedApp(pool, {
      teamSlug: 'team-j',
      appName: 'app-j-12',
      environment: 'prod-fss',
      auditStartYear: 2023,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-n',
      githubRepoId: '904',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-n',
      githubRepoId: '904',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appC,
      githubOwner: 'navikt',
      githubRepo: 'monorepo-n',
      githubRepoId: '904',
    })

    await reconcileAuditStartYearOnRepoActivation(appA, true)

    expect(await getAuditStartYear(appA)).toBe(2021)
    expect(await getAuditStartYear(appB)).toBe(2021)
    expect(await getAuditStartYear(appC)).toBe(2021)
  })
})
