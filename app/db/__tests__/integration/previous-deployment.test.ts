import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { seedApp, seedApplicationRepository, seedDeployment, truncateAllTables } from './helpers'

vi.mock('~/lib/github', () => ({
  getCommitAncestryStatus: vi.fn(),
}))

import { getCommitAncestryStatus } from '~/lib/github'
import { getPreviousDeployment } from '~/lib/verification/fetch-data/previous-deployment.server'

const mockedGetCommitAncestryStatus = vi.mocked(getCommitAncestryStatus)

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  vi.resetAllMocks()
  await truncateAllTables(pool)
})

describe('getPreviousDeployment', () => {
  const owner = 'navikt'
  const repo = 'pensjon-regler'
  const githubRepoId = '1001'

  it('should return null when repository has no known github_repo_id', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'abc123',
      fourEyesStatus: 'pending',
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, null, null, 'abc123')
    expect(prev).toBeNull()
    expect(mockedGetCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('should skip legacy deployments and return null when no valid previous exists', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'refs/heads/main',
      fourEyesStatus: 'legacy',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'abc123',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'abc123')
    expect(prev).toBeNull()
    expect(mockedGetCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('should skip deployments with refs/ commit SHAs', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'refs/heads/feature',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'def456',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'def456')
    expect(prev).toBeNull()
  })

  it('validates ancestry even for a single candidate (regular single-app case)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'refs/heads/main',
      fourEyesStatus: 'legacy',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const validId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'aaa111',
      fourEyesStatus: 'pending_baseline',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'bbb222',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-03-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('ahead')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'bbb222')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(validId)
    expect(prev?.commitSha).toBe('aaa111')
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(1)
  })

  it('should skip legacy_pending deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'ccc333',
      fourEyesStatus: 'legacy_pending',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'ddd444',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'ddd444')
    expect(prev).toBeNull()
  })

  it('should respect auditStartYear and exclude older deployments', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team',
      appName: 'app',
      environment: 'prod',
      auditStartYear: 2025,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'old111',
      fourEyesStatus: 'approved',
      createdAt: new Date('2024-06-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const validId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'new222',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-03-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'cur333',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-04-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('ahead')

    const prevNoFilter = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'cur333')
    expect(prevNoFilter?.id).toBe(validId)

    const prevWithYear = await getPreviousDeployment(currentId, owner, repo, githubRepoId, 2025, 'cur333')
    expect(prevWithYear?.id).toBe(validId)

    const prevStrictYear = await getPreviousDeployment(currentId, owner, repo, githubRepoId, 2026, 'cur333')
    expect(prevStrictYear).toBeNull()
  })

  it('should find a previous deployment from a sibling app in the same monorepo, same environment', async () => {
    const appBackend = await seedApp(pool, {
      teamSlug: 'team',
      appName: 'saksoversikt-backend',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appBackend,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })
    const appFrontend = await seedApp(pool, {
      teamSlug: 'team',
      appName: 'saksoversikt-frontend',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appFrontend,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    const siblingId = await seedDeployment(pool, {
      monitoredAppId: appFrontend,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'sibling-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appBackend,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-01-01T10:00:05Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('ahead')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(siblingId)
    expect(prev?.commitSha).toBe('sibling-sha')
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(1)
  })

  it('should find a previous deployment from a sibling app in a different environment (cross-environment, no env filter)', async () => {
    const appFss = await seedApp(pool, { teamSlug: 'team', appName: 'pensjon-psak', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appFss,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })
    const appGcp = await seedApp(pool, { teamSlug: 'team', appName: 'pensjon-penny', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appGcp,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    const siblingId = await seedDeployment(pool, {
      monitoredAppId: appFss,
      teamSlug: 'team',
      environment: 'prod-fss',
      commitSha: 'aaa111',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appGcp,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'bbb222',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('ahead')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'bbb222')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(siblingId)
    expect(prev?.commitSha).toBe('aaa111')
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(1)
  })

  it('should skip a candidate whose ancestry check returns diverged (history_anomaly) and use an older valid candidate', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'svc-a', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })
    const app2 = await seedApp(pool, { teamSlug: 'team', appName: 'svc-b', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    const olderValidId = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'older-valid-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team',
      environment: 'prod-fss',
      commitSha: 'diverged-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockImplementation(async (_owner, _repo, base) => {
      if (base === 'diverged-sha') return 'diverged'
      if (base === 'older-valid-sha') return 'ahead'
      return null
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(olderValidId)
    expect(prev?.commitSha).toBe('older-valid-sha')
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledWith(owner, repo, 'diverged-sha', 'current-sha', 1001)
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledWith(owner, repo, 'older-valid-sha', 'current-sha', 1001)
  })

  it('should return null (pending_baseline) when no candidate can be confirmed as an ancestor', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'svc-a', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })
    const app2 = await seedApp(pool, { teamSlug: 'team', appName: 'svc-b', environment: 'prod-fss' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'diverged-one',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })
    await seedDeployment(pool, {
      monitoredAppId: app2,
      teamSlug: 'team',
      environment: 'prod-fss',
      commitSha: 'diverged-two',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('diverged')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).toBeNull()
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(2)
  })

  it('should keep searching older candidates beyond the first page when all page-1 candidates are diverged', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'svc-a', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    const validId = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'oldest-valid-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    for (let i = 0; i < 25; i++) {
      await seedDeployment(pool, {
        monitoredAppId: app1,
        teamSlug: 'team',
        environment: 'prod-gcp',
        commitSha: `diverged-sha-${i}`,
        fourEyesStatus: 'approved',
        createdAt: new Date(`2025-01-02T00:${String(i).padStart(2, '0')}:00Z`),
        githubOwner: owner,
        githubRepo: repo,
      })
    }

    const currentId = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T00:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockImplementation(async (_owner, _repo, base) => {
      if (base === 'oldest-valid-sha') return 'ahead'
      return 'diverged'
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(validId)
    expect(prev?.commitSha).toBe('oldest-valid-sha')
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(26)
  })

  it('should stop searching and return null once the candidate pagination limit is reached (all candidates diverged)', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team', appName: 'svc-b', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    for (let i = 0; i < 205; i++) {
      await seedDeployment(pool, {
        monitoredAppId: app1,
        teamSlug: 'team',
        environment: 'prod-gcp',
        commitSha: `diverged-sha-${i}`,
        fourEyesStatus: 'approved',
        createdAt: new Date(
          `2025-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
        ),
        githubOwner: owner,
        githubRepo: repo,
      })
    }

    const currentId = await seedDeployment(pool, {
      monitoredAppId: app1,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T00:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('diverged')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).toBeNull()
    // MAX_CANDIDATE_PAGES (10) * CANDIDATE_PAGE_SIZE (20) = 200 candidates checked, then it gives up.
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(200)
  })

  it('should not return a deployment from a different, unrelated repo (different github_repo_id)', async () => {
    const appA = await seedApp(pool, { teamSlug: 'team', appName: 'app-a', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })
    const appB = await seedApp(pool, { teamSlug: 'team', appName: 'app-b', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId: '9999',
    })

    await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'other-repo-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).toBeNull()
    expect(mockedGetCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('should still use a deployment from an inactive sibling app as baseline (historical fact, independent of current monitoring status)', async () => {
    const activeApp = await seedApp(pool, { teamSlug: 'team', appName: 'active-app', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: activeApp,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })
    const inactiveApp = await seedApp(pool, {
      teamSlug: 'team',
      appName: 'inactive-app',
      environment: 'prod-fss',
      isActive: false,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: inactiveApp,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    const inactiveDeploymentId = await seedDeployment(pool, {
      monitoredAppId: inactiveApp,
      teamSlug: 'team',
      environment: 'prod-fss',
      commitSha: 'inactive-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: activeApp,
      teamSlug: 'team',
      environment: 'prod-gcp',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('ahead')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(inactiveDeploymentId)
    expect(prev?.commitSha).toBe('inactive-sha')
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(1)
  })

  it('should still return a candidate whose detected repo strings differ from the current application_repositories link (repo rename tolerance via historical row)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'old-owner',
      githubRepo: 'old-repo-name',
      githubRepoId,
      status: 'historical',
    })

    const renamedId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'pre-rename-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: 'old-owner',
      githubRepo: 'old-repo-name',
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('ahead')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(renamedId)
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(1)
  })

  it('should not treat deployments from an app’s previous (org-transferred) repo as candidates for the new repo when only the current active repo row shares a name', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'old-org',
      githubRepo: repo,
      githubRepoId: '555',
      status: 'historical',
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'old-org-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: 'old-org',
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).toBeNull()
    expect(mockedGetCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('should exclude candidates with four_eyes_status = unauthorized_repository and use an older authorized candidate', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: owner,
      githubRepo: repo,
      githubRepoId,
    })

    const validId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'authorized-sha',
      fourEyesStatus: 'approved',
      createdAt: new Date('2025-01-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'unauthorized-sha',
      fourEyesStatus: 'unauthorized_repository',
      createdAt: new Date('2025-01-15T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    const currentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      commitSha: 'current-sha',
      fourEyesStatus: 'pending',
      createdAt: new Date('2025-02-01T10:00:00Z'),
      githubOwner: owner,
      githubRepo: repo,
    })

    mockedGetCommitAncestryStatus.mockResolvedValue('ahead')

    const prev = await getPreviousDeployment(currentId, owner, repo, githubRepoId, null, 'current-sha')
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(validId)
    expect(prev?.commitSha).toBe('authorized-sha')
    expect(mockedGetCommitAncestryStatus).toHaveBeenCalledTimes(1)
  })
})
