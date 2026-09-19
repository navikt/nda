import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getGitHubDataStatsForRepository } from '~/db/github-data/compare-stats.server'
import { getLatestSyncJobForRepository } from '~/db/sync-jobs.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

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

describe('getGitHubDataStatsForRepository', () => {
  it('counts deployments matched to the repository via detected owner/repo, regardless of the app id used', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '960001',
      githubOwner: 'navikt',
      githubRepoName: 'repo-stats-a',
    })
    const appA = await seedApp(pool, { teamSlug: 'team-stats', appName: 'app-stats-a', environment: 'prod-gcp' })
    const appB = await seedApp(pool, { teamSlug: 'team-stats', appName: 'app-stats-b', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appA,
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-a',
      githubRepoId: '960001',
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appB,
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-a',
      githubRepoId: '960001',
      status: 'active',
    })

    await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-stats',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-a',
      commitSha: 'abcdef1',
    })
    await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-stats',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-a',
      commitSha: 'abcdef2',
    })

    const stats = await getGitHubDataStatsForRepository(repositoryId)

    expect(stats.total).toBe(2)
    expect(stats.withoutData).toBe(2)
  })

  it('excludes deployments detected against a different repository even for a linked app', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '960002',
      githubOwner: 'navikt',
      githubRepoName: 'repo-stats-b',
    })
    await seedRepository(pool, {
      githubRepoId: '960003',
      githubOwner: 'navikt',
      githubRepoName: 'repo-stats-other',
    })
    const app = await seedApp(pool, { teamSlug: 'team-stats', appName: 'app-stats-c', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-b',
      githubRepoId: '960002',
      status: 'active',
    })

    await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-stats',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-b',
      commitSha: 'abcdef3',
    })
    await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-stats',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-other',
      commitSha: 'abcdef4',
    })

    const stats = await getGitHubDataStatsForRepository(repositoryId)

    expect(stats.total).toBe(1)
  })

  it('includes deployments recorded while the app was historically linked to the repository', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '960004',
      githubOwner: 'navikt',
      githubRepoName: 'repo-stats-old',
    })
    await seedRepository(pool, {
      githubRepoId: '960005',
      githubOwner: 'navikt',
      githubRepoName: 'repo-stats-new',
    })
    const app = await seedApp(pool, { teamSlug: 'team-stats', appName: 'app-stats-d', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-old',
      githubRepoId: '960004',
      status: 'historical',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-new',
      githubRepoId: '960005',
      status: 'active',
    })

    await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-stats',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'repo-stats-old',
      commitSha: 'abcdef5',
    })

    const stats = await getGitHubDataStatsForRepository(repositoryId)

    expect(stats.total).toBe(1)
  })
})

describe('getLatestSyncJobForRepository', () => {
  it('returns the most recent job for the given repository and job type', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '960006',
      githubOwner: 'navikt',
      githubRepoName: 'repo-sync-a',
    })
    const otherRepositoryId = await seedRepository(pool, {
      githubRepoId: '960007',
      githubOwner: 'navikt',
      githubRepoName: 'repo-sync-b',
    })

    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, completed_at, created_at)
       VALUES ('fetch_verification_data', NULL, $1, 'completed', NOW() - interval '1 hour', NOW() - interval '1 hour', NOW() - interval '1 hour')`,
      [repositoryId],
    )
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, completed_at, created_at)
       VALUES ('fetch_verification_data', NULL, $1, 'completed', NOW(), NOW(), NOW())
       RETURNING id`,
      [repositoryId],
    )
    await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, repository_id, status, started_at, completed_at, created_at)
       VALUES ('fetch_verification_data', NULL, $1, 'completed', NOW(), NOW(), NOW())`,
      [otherRepositoryId],
    )

    const job = await getLatestSyncJobForRepository(repositoryId, 'fetch_verification_data')

    expect(job?.id).toBe(rows[0].id)
    expect(job?.repository_id).toBe(repositoryId)
  })

  it('returns null when no jobs exist for the repository', async () => {
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '960008',
      githubOwner: 'navikt',
      githubRepoName: 'repo-sync-c',
    })

    const job = await getLatestSyncJobForRepository(repositoryId, 'fetch_verification_data')

    expect(job).toBeNull()
  })
})
