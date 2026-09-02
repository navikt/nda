import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { seedApp, seedApplicationRepository, truncateAllTables } from './helpers'

vi.mock('~/lib/github/git.server', () => ({
  getRepositoryId: vi.fn(),
}))

import { getRepositoryId } from '~/lib/github/git.server'
import { getAppIdsSharingRepo, upsertApplicationRepository } from '../../application-repositories.server'

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

describe('application-repositories', () => {
  it('creates a repository in pending_approval status', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    const { rows } = await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'my-repo', 'pending_approval') RETURNING *`,
      [appId],
    )
    expect(rows[0].status).toBe('pending_approval')
    expect(rows[0].approved_at).toBeNull()
  })

  it('approves a repository and sets it active', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    const { rows: created } = await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'repo', 'pending_approval') RETURNING *`,
      [appId],
    )

    const { rows: approved } = await pool.query(
      "UPDATE application_repositories SET status = 'active', approved_at = NOW(), approved_by = 'bob' WHERE id = $1 RETURNING *",
      [created[0].id],
    )
    expect(approved[0].status).toBe('active')
    expect(approved[0].approved_by).toBe('bob')
    expect(approved[0].approved_at).not.toBeNull()
  })

  it('enforces unique constraint on (monitored_app_id, github_owner, github_repo_name)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'repo', 'active')`,
      [appId],
    )

    await expect(
      pool.query(
        `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
         VALUES ($1, 'navikt', 'repo', 'pending_approval')`,
        [appId],
      ),
    ).rejects.toThrow(/unique|duplicate/)
  })

  it('upsert updates status on conflict', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'repo', 'pending_approval')`,
      [appId],
    )

    await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status, approved_at, approved_by)
       VALUES ($1, 'navikt', 'repo', 'active', NOW(), 'alice')
       ON CONFLICT (monitored_app_id, github_owner, github_repo_name) DO UPDATE SET
         status = EXCLUDED.status, approved_at = EXCLUDED.approved_at, approved_by = EXCLUDED.approved_by`,
      [appId],
    )

    const { rows } = await pool.query(
      "SELECT * FROM application_repositories WHERE monitored_app_id = $1 AND github_owner = 'navikt'",
      [appId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('active')
    expect(rows[0].approved_by).toBe('alice')
  })

  it('setting one repo active deactivates others for same app', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    const { rows: _repo1 } = await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'old-repo', 'active') RETURNING *`,
      [appId],
    )
    const { rows: repo2 } = await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'new-repo', 'historical') RETURNING *`,
      [appId],
    )

    await pool.query(
      "UPDATE application_repositories SET status = 'historical' WHERE monitored_app_id = $1 AND id != $2 AND status = 'active'",
      [appId, repo2[0].id],
    )
    await pool.query("UPDATE application_repositories SET status = 'active' WHERE id = $1", [repo2[0].id])

    const { rows } = await pool.query(
      'SELECT * FROM application_repositories WHERE monitored_app_id = $1 ORDER BY id',
      [appId],
    )
    expect(rows[0].status).toBe('historical')
    expect(rows[1].status).toBe('active')
  })

  it('rejects (deletes) pending repository', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    const { rows: created } = await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'repo', 'pending_approval') RETURNING *`,
      [appId],
    )

    await pool.query("DELETE FROM application_repositories WHERE id = $1 AND status = 'pending_approval'", [
      created[0].id,
    ])

    const { rows } = await pool.query('SELECT * FROM application_repositories WHERE id = $1', [created[0].id])
    expect(rows).toHaveLength(0)
  })

  it('reject does not delete active repositories', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    const { rows: created } = await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'repo', 'active') RETURNING *`,
      [appId],
    )

    await pool.query("DELETE FROM application_repositories WHERE id = $1 AND status = 'pending_approval'", [
      created[0].id,
    ])

    const { rows } = await pool.query('SELECT * FROM application_repositories WHERE id = $1', [created[0].id])
    expect(rows).toHaveLength(1)
  })

  it('github_repo_id defaults to null and can be backfilled', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    const { rows: created } = await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status)
       VALUES ($1, 'navikt', 'repo', 'active') RETURNING *`,
      [appId],
    )
    expect(created[0].github_repo_id).toBeNull()

    const { rows: updated } = await pool.query(
      'UPDATE application_repositories SET github_repo_id = $1 WHERE id = $2 RETURNING *',
      [123456, created[0].id],
    )
    expect(Number(updated[0].github_repo_id)).toBe(123456)
  })

  it('upsertApplicationRepository populates github_repo_id from getRepositoryId', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    vi.mocked(getRepositoryId).mockResolvedValueOnce(987654)

    await upsertApplicationRepository({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo',
      status: 'active',
    })

    const { rows } = await pool.query(
      "SELECT * FROM application_repositories WHERE monitored_app_id = $1 AND github_owner = 'navikt' AND github_repo_name = 'repo'",
      [appId],
    )
    expect(Number(rows[0].github_repo_id)).toBe(987654)
  })

  it('upsertApplicationRepository does not overwrite an existing github_repo_id on conflict', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })
    vi.mocked(getRepositoryId).mockResolvedValueOnce(111)

    await upsertApplicationRepository({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo',
      status: 'pending_approval',
    })

    vi.mocked(getRepositoryId).mockResolvedValueOnce(222)

    await upsertApplicationRepository({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo',
      status: 'active',
      approvedBy: 'alice',
    })

    const { rows } = await pool.query(
      "SELECT * FROM application_repositories WHERE monitored_app_id = $1 AND github_owner = 'navikt' AND github_repo_name = 'repo'",
      [appId],
    )
    expect(Number(rows[0].github_repo_id)).toBe(111)
    expect(rows[0].status).toBe('active')
  })

  it('redirect configuration works', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    await pool.query(
      `INSERT INTO application_repositories (monitored_app_id, github_owner, github_repo_name, status, redirects_to_owner, redirects_to_repo)
       VALUES ($1, 'navikt', 'old-repo', 'active', 'navikt', 'new-repo')`,
      [appId],
    )

    const { rows } = await pool.query(
      "SELECT * FROM application_repositories WHERE monitored_app_id = $1 AND github_owner = 'navikt' AND github_repo_name = 'old-repo'",
      [appId],
    )
    expect(rows[0].redirects_to_owner).toBe('navikt')
    expect(rows[0].redirects_to_repo).toBe('new-repo')
  })
})

describe('getAppIdsSharingRepo', () => {
  it('returns app ids grouped by shared active github_repo_id', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-fss' })
    const app3 = await seedApp(pool, { teamSlug: 'team-b', appName: 'svc-b', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: 'navikt',
      githubRepo: 'mono',
      githubRepoId: '901',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: 'navikt',
      githubRepo: 'mono',
      githubRepoId: '901',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app3,
      githubOwner: 'navikt',
      githubRepo: 'svc-b',
      githubRepoId: '902',
    })

    const result = await getAppIdsSharingRepo([app1, app2, app3])
    expect(result.get('901')?.sort()).toEqual([app1, app2].sort())
    expect(result.get('902')).toEqual([app3])
  })

  it('returns an empty map for an empty list of app ids', async () => {
    const result = await getAppIdsSharingRepo([])
    expect(result.size).toBe(0)
  })

  it('excludes siblings belonging to an inactive app', async () => {
    const app1 = await seedApp(pool, { teamSlug: 'team-a', appName: 'svc-a', environment: 'prod-gcp' })
    const app2 = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'svc-a',
      environment: 'prod-fss',
      isActive: false,
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app1,
      githubOwner: 'navikt',
      githubRepo: 'mono',
      githubRepoId: '903',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app2,
      githubOwner: 'navikt',
      githubRepo: 'mono',
      githubRepoId: '903',
    })

    const result = await getAppIdsSharingRepo([app1])
    expect(result.get('903')).toEqual([app1])
  })
})
