import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getAllMonorepoGroups, getMonorepoSiblings, propagateVerificationToSiblings } from '../../monorepo.server'
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

async function setDefaultBranch(appId: number, branch: string): Promise<void> {
  await pool.query('UPDATE monitored_applications SET default_branch = $1 WHERE id = $2', [branch, appId])
}

async function setAuditStartYear(appId: number, year: number | null): Promise<void> {
  await pool.query('UPDATE monitored_applications SET audit_start_year = $1 WHERE id = $2', [year, appId])
}

async function setAppInactive(appId: number): Promise<void> {
  await pool.query('UPDATE monitored_applications SET is_active = false WHERE id = $1', [appId])
}

describe('getAllMonorepoGroups', () => {
  const owner = 'navikt'
  const repo = 'monorepo-example'

  it('should return an empty list when no repo is shared by multiple apps', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'solo-app', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(0)
  })

  it('should detect a monorepo when two active apps share an active repo', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].github_owner).toBe(owner)
    expect(groups[0].github_repo_name).toBe(repo)
    expect(groups[0].apps.map((a) => a.app_name).sort()).toEqual(['service-a', 'service-b'])
  })

  it('should not count historical or pending_approval repository links', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: owner,
      githubRepo: repo,
      status: 'historical',
    })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(0)
  })

  it('should not include apps that are inactive', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setAppInactive(appB)

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(0)
  })

  it('should flag base_branch_mismatch when apps have different default branches', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setDefaultBranch(appA, 'main')
    await setDefaultBranch(appB, 'master')

    const groups = await getAllMonorepoGroups()
    expect(groups[0].base_branch_mismatch).toBe(true)
  })

  it('should not flag base_branch_mismatch when apps share the same default branch', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setDefaultBranch(appA, 'main')
    await setDefaultBranch(appB, 'main')

    const groups = await getAllMonorepoGroups()
    expect(groups[0].base_branch_mismatch).toBe(false)
  })

  it('should flag audit_year_mismatch when apps have different audit start years', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'service-a',
      environment: 'prod',
      auditStartYear: 2024,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'service-b',
      environment: 'prod',
      auditStartYear: 2025,
    })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups[0].audit_year_mismatch).toBe(true)
  })

  it('should not flag audit_year_mismatch when apps share the same audit start year', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'service-a',
      environment: 'prod',
      auditStartYear: 2025,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'service-b',
      environment: 'prod',
      auditStartYear: 2025,
    })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const groups = await getAllMonorepoGroups()
    expect(groups[0].audit_year_mismatch).toBe(false)
  })

  it('should keep separate repos as separate groups', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    const appC = await seedApp(pool, { teamSlug: 'team-c', appName: 'service-c', environment: 'prod' })
    const appD = await seedApp(pool, { teamSlug: 'team-d', appName: 'service-d', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appC, githubOwner: owner, githubRepo: 'other-repo' })
    await seedApplicationRepository(pool, { monitoredAppId: appD, githubOwner: owner, githubRepo: 'other-repo' })

    const groups = await getAllMonorepoGroups()
    expect(groups).toHaveLength(2)
  })
})

describe('getMonorepoSiblings', () => {
  const owner = 'navikt'
  const repo = 'monorepo-example'

  it('should return null when the app has no active repository', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'solo-app', environment: 'prod' })

    const info = await getMonorepoSiblings(appId)
    expect(info).toBeNull()
  })

  it('should return null when no other app shares the repo', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'solo-app', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appId, githubOwner: owner, githubRepo: repo })

    const info = await getMonorepoSiblings(appId)
    expect(info).toBeNull()
  })

  it('should return siblings excluding the app itself', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })

    const info = await getMonorepoSiblings(appA)
    expect(info).not.toBeNull()
    expect(info?.github_owner).toBe(owner)
    expect(info?.github_repo_name).toBe(repo)
    expect(info?.siblings.map((s) => s.id)).toEqual([appB])
  })

  it('should compute mismatch flags including the app itself', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setDefaultBranch(appA, 'main')
    await setDefaultBranch(appB, 'master')
    await setAuditStartYear(appA, 2025)
    await setAuditStartYear(appB, 2025)

    const info = await getMonorepoSiblings(appA)
    expect(info?.base_branch_mismatch).toBe(true)
    expect(info?.audit_year_mismatch).toBe(false)
  })

  it('should not include inactive sibling apps', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setAppInactive(appB)

    const info = await getMonorepoSiblings(appA)
    expect(info).toBeNull()
  })

  it('should return null when the app itself is inactive, even if active apps share its repo', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team-a', appName: 'service-a', environment: 'prod' })
    const appB = await seedApp(pool, { teamSlug: 'team-b', appName: 'service-b', environment: 'prod' })
    await seedApplicationRepository(pool, { monitoredAppId: appA, githubOwner: owner, githubRepo: repo })
    await seedApplicationRepository(pool, { monitoredAppId: appB, githubOwner: owner, githubRepo: repo })
    await setAppInactive(appA)

    const info = await getMonorepoSiblings(appA)
    expect(info).toBeNull()
  })
})

describe('propagateVerificationToSiblings', () => {
  const owner = 'navikt'
  const repo = 'monorepo-example'

  it('should propagate approved status to sibling deployments with same commit SHA in the same repo', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'abc123def456'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(1)

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].four_eyes_status).toBe('approved')
  })

  it('should NOT propagate negative statuses', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'abc123def456'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'unverified_commits',
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'unverified_commits', commitSha, app1)
    expect(propagated).toBe(0)
  })

  it('should NOT propagate to deployments with different commit SHA', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'sha-one',
      fourEyesStatus: 'approved',
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha: 'sha-two',
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', 'sha-one', app1)
    expect(propagated).toBe(0)

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].four_eyes_status).toBe('pending')
  })

  it('should NOT propagate to already-verified sibling deployments', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'manually_approved',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(0)
  })

  it('should NOT propagate when app has no active repository', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    const dep = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'abc123',
      fourEyesStatus: 'approved',
    })

    const propagated = await propagateVerificationToSiblings(dep, 'approved', 'abc123', appId)
    expect(propagated).toBe(0)
  })

  it('should NOT propagate when app has an active repository but no github_repo_id yet', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, { monitoredAppId: app1, githubOwner: owner, githubRepo: repo })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, { monitoredAppId: app2, githubOwner: owner, githubRepo: repo })

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(0)
  })

  it('should NOT propagate to a sibling deployment belonging to an inactive app', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-active', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'svc-inactive',
      environment: 'prod-fss',
      isActive: false,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'inactive-sibling-sha'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(0)

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].four_eyes_status).toBe('pending')
  })

  it('should propagate manually_approved status', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'manually_approved',
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'manually_approved', commitSha, app1)
    expect(propagated).toBe(1)

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].four_eyes_status).toBe('manually_approved')
  })

  it('should propagate to multiple siblings at once, including cross-environment ones', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app3 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc', environment: 'dev-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app3,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })
    await seedDeployment(pool, {
      monitoredAppId: app3,
      teamSlug: 'team-b',
      environment: 'dev-gcp',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(2)

    const { rows } = await pool.query(
      "SELECT id, four_eyes_status FROM deployments WHERE four_eyes_status = 'approved' ORDER BY id",
    )
    expect(rows).toHaveLength(3)
  })

  it('should NOT propagate to a different github_repo_id even with matching owner/repo string', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '2002',
    })

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, 'approved', commitSha, app1)
    expect(propagated).toBe(0)
  })

  it.each([
    { status: 'implicitly_approved', label: 'implicitly_approved' },
    { status: 'no_changes', label: 'no_changes' },
    { status: 'approved_pr_with_unreviewed', label: 'approved_pr_with_unreviewed' },
  ])('should propagate $label status', async ({ status }) => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: status,
    })
    const dep2 = await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, status, commitSha, app1)
    expect(propagated).toBe(1)

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [dep2])
    expect(rows[0].four_eyes_status).toBe(status)
  })

  it.each([
    { status: 'unverified_commits', label: 'unverified_commits' },
    { status: 'unauthorized_repository', label: 'unauthorized_repository' },
    { status: 'unauthorized_branch', label: 'unauthorized_branch' },
    { status: 'error', label: 'error' },
    { status: 'pending_baseline', label: 'pending_baseline' },
  ])('should NOT propagate $label status', async ({ status }) => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '1001',
    })

    const commitSha = 'abc123'
    const dep1 = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha,
      fourEyesStatus: status,
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      commitSha,
      fourEyesStatus: 'pending',
    })

    const propagated = await propagateVerificationToSiblings(dep1, status, commitSha, app1)
    expect(propagated).toBe(0)
  })
})
