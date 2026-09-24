import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

// Mirrors the repository-scoped CTE built by fetchVerificationDataForRepository() in
// app/lib/verification/fetch-data/bulk-fetch.server.ts (ID-first WHERE predicate + immutable-id
// partition key). Keep this query text in sync with that file if it changes.
const REPOSITORY_SCOPED_QUERY = `
  SELECT d.id, d.github_repo_id,
         LAG(d.commit_sha) OVER (
           PARTITION BY COALESCE(d.github_repo_id::text, d.detected_github_owner || '/' || d.detected_github_repo_name)
           ORDER BY d.created_at ASC, d.id ASC
         ) AS prev_commit_sha
  FROM deployments d
  JOIN monitored_applications ma ON d.monitored_app_id = ma.id
  WHERE d.commit_sha IS NOT NULL
    AND d.detected_github_owner IS NOT NULL
    AND d.detected_github_repo_name IS NOT NULL
    AND (
      CASE
        WHEN d.github_repo_id IS NOT NULL THEN
          d.github_repo_id = (SELECT r.github_repo_id FROM repositories r WHERE r.id = $1)
          AND EXISTS (
            SELECT 1 FROM application_repositories ar
            WHERE ar.monitored_app_id = d.monitored_app_id
              AND ar.status IN ('active', 'historical')
              AND (
                ar.github_repo_id = d.github_repo_id
                OR (
                  ar.github_repo_id IS NULL
                  AND ar.github_owner = d.detected_github_owner
                  AND ar.github_repo_name = d.detected_github_repo_name
                )
              )
          )
        ELSE
          EXISTS (
            SELECT 1 FROM application_repositories ar
            JOIN repositories r ON r.github_repo_id = ar.github_repo_id
            WHERE ar.monitored_app_id = d.monitored_app_id
              AND ar.github_owner = d.detected_github_owner
              AND ar.github_repo_name = d.detected_github_repo_name
              AND ar.status IN ('active', 'historical')
              AND r.id = $1
              AND (d.trigger_url IS NULL OR d.trigger_url !~ '/actions/runs/[0-9]+')
          )
      END
    )
  ORDER BY d.created_at ASC, d.id ASC`

describe('repository-scoped bulk-fetch query (ID-first predicate + partition)', () => {
  it('includes a deployment via its own immutable github_repo_id when the app link matches by id even though its recorded owner/name is stale', async () => {
    const repoId = await seedRepository(pool, {
      githubRepoId: '500001',
      githubOwner: 'navikt',
      githubRepoName: 'renamed-repo',
    })
    const app = await seedApp(pool, { teamSlug: 'team-bfrq', appName: 'app-bfrq-idmatch', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'old-name',
      githubRepoId: '500001',
      status: 'active',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-bfrq',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'old-name',
      githubRepoId: '500001',
    })

    const { rows } = await pool.query(REPOSITORY_SCOPED_QUERY, [repoId])

    expect(rows.map((r) => r.id)).toEqual([deploymentId])
  })

  it('excludes a deployment whose own github_repo_id matches the target repository but the app has no recorded link to it', async () => {
    const repoId = await seedRepository(pool, {
      githubRepoId: '500006',
      githubOwner: 'navikt',
      githubRepoName: 'unlinked-repo',
    })
    const app = await seedApp(pool, { teamSlug: 'team-bfrq', appName: 'app-bfrq-unlinked', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'other-repo',
      githubRepoId: '999999',
      status: 'active',
    })
    await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-bfrq',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'other-repo',
      githubRepoId: '500006',
    })

    const { rows } = await pool.query(REPOSITORY_SCOPED_QUERY, [repoId])

    expect(rows).toHaveLength(0)
  })

  it('excludes a deployment whose own github_repo_id points at a different repository, even if the owner/name matches', async () => {
    const repoId = await seedRepository(pool, {
      githubRepoId: '500002',
      githubOwner: 'navikt',
      githubRepoName: 'reused-name',
    })
    const app = await seedApp(pool, { teamSlug: 'team-bfrq', appName: 'app-bfrq-mismatch', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'reused-name',
      githubRepoId: '500002',
      status: 'active',
    })
    // This deployment's own immutable id belongs to a different (e.g. deleted/renamed) repository
    // that used to have this same owner/name — must not be treated as belonging to repoId.
    await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-bfrq',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'reused-name',
      githubRepoId: '111111',
    })

    const { rows } = await pool.query(REPOSITORY_SCOPED_QUERY, [repoId])

    expect(rows).toHaveLength(0)
  })

  it('falls back to the owner/name app link when github_repo_id is not yet backfilled', async () => {
    const repoId = await seedRepository(pool, {
      githubRepoId: '500003',
      githubOwner: 'navikt',
      githubRepoName: 'not-yet-backfilled',
    })
    const app = await seedApp(pool, { teamSlug: 'team-bfrq', appName: 'app-bfrq-fallback', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'not-yet-backfilled',
      githubRepoId: '500003',
      status: 'active',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-bfrq',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'not-yet-backfilled',
      githubRepoId: null,
    })

    const { rows } = await pool.query(REPOSITORY_SCOPED_QUERY, [repoId])

    expect(rows.map((r) => r.id)).toEqual([deploymentId])
  })

  it('excludes a deployment with no github_repo_id yet but a resolvable trigger_url, instead of falling back to owner/name', async () => {
    const repoId = await seedRepository(pool, {
      githubRepoId: '500004',
      githubOwner: 'navikt',
      githubRepoName: 'pending-backfill',
    })
    const app = await seedApp(pool, {
      teamSlug: 'team-bfrq',
      appName: 'app-bfrq-pending-backfill',
      environment: 'prod-gcp',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'pending-backfill',
      githubRepoId: '500004',
      status: 'active',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-bfrq',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'pending-backfill',
      githubRepoId: null,
    })
    await pool.query(`UPDATE deployments SET trigger_url = $1 WHERE id = $2`, [
      'https://github.com/navikt/pending-backfill/actions/runs/999999',
      deploymentId,
    ])

    const { rows } = await pool.query(REPOSITORY_SCOPED_QUERY, [repoId])

    expect(rows.map((r) => r.id)).toEqual([])
  })

  it('partitions prev_commit_sha by immutable github_repo_id, not by owner/name, across a reused name', async () => {
    const oldRepoId = await seedRepository(pool, {
      githubRepoId: '500004',
      githubOwner: 'navikt',
      githubRepoName: 'shared-name',
    })
    const newRepoId = await seedRepository(pool, {
      githubRepoId: '500005',
      githubOwner: 'navikt',
      githubRepoName: 'shared-name-2',
    })
    const app = await seedApp(pool, { teamSlug: 'team-bfrq', appName: 'app-bfrq-partition', environment: 'prod-gcp' })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'shared-name-old',
      githubRepoId: '500004',
      status: 'historical',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: app,
      githubOwner: 'navikt',
      githubRepo: 'shared-name',
      githubRepoId: '500005',
      status: 'active',
    })

    const older = await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-bfrq',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'shared-name',
      githubRepoId: '500004',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      commitSha: 'old-repo-sha',
    })
    const newer = await seedDeployment(pool, {
      monitoredAppId: app,
      teamSlug: 'team-bfrq',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'shared-name',
      githubRepoId: '500005',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      commitSha: 'new-repo-sha',
    })

    const { rows } = await pool.query(REPOSITORY_SCOPED_QUERY, [newRepoId])

    // Only the deployment belonging to the new repository (500005) is in scope, and it must not
    // be treated as a continuation of the old repository's deployment (prev_commit_sha is NULL).
    expect(rows.map((r) => r.id)).toEqual([newer])
    expect(rows[0].prev_commit_sha).toBeNull()

    const oldRows = await pool.query(REPOSITORY_SCOPED_QUERY, [oldRepoId])
    expect(oldRows.rows.map((r) => r.id)).toEqual([older])
  })
})
