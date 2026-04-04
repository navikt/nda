/**
 * Integration test: getPreviousDeployment query logic.
 *
 * Verifies that legacy deployments and invalid refs are excluded
 * when finding the previous deployment for verification.
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
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

/**
 * Replicates the getPreviousDeployment query from fetch-data.server.ts.
 * We test the SQL directly since the function is private.
 */
async function getPreviousDeployment(
  currentDeploymentId: number,
  environmentName: string,
  owner: string,
  repo: string,
): Promise<{ id: number; commitSha: string } | null> {
  const result = await pool.query(
    `SELECT d.id, d.commit_sha
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.created_at < (SELECT created_at FROM deployments WHERE id = $1)
       AND ma.environment_name = $2
       AND d.detected_github_owner = $3
       AND d.detected_github_repo_name = $4
       AND d.commit_sha IS NOT NULL
       AND d.four_eyes_status NOT IN ('legacy', 'legacy_pending')
       AND d.commit_sha !~ '^refs/'
     ORDER BY d.created_at DESC
     LIMIT 1`,
    [currentDeploymentId, environmentName, owner, repo],
  )

  if (result.rows.length === 0) return null
  return { id: result.rows[0].id, commitSha: result.rows[0].commit_sha }
}

describe('getPreviousDeployment query', () => {
  const owner = 'navikt'
  const repo = 'pensjon-regler'

  it('should skip legacy deployments and return null when no valid previous exists', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    // Legacy deployment (old)
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

    // Current deployment (new)
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

    const prev = await getPreviousDeployment(currentId, 'prod', owner, repo)
    expect(prev).toBeNull()
  })

  it('should skip deployments with refs/ commit SHAs', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    // Deployment with refs/ SHA but not legacy status
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

    const prev = await getPreviousDeployment(currentId, 'prod', owner, repo)
    expect(prev).toBeNull()
  })

  it('should return a valid non-legacy previous deployment', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    // Legacy (oldest)
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

    // Valid previous deployment (middle)
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

    // Current deployment (newest)
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

    const prev = await getPreviousDeployment(currentId, 'prod', owner, repo)
    expect(prev).not.toBeNull()
    expect(prev?.id).toBe(validId)
    expect(prev?.commitSha).toBe('aaa111')
  })

  it('should skip legacy_pending deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

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

    const prev = await getPreviousDeployment(currentId, 'prod', owner, repo)
    expect(prev).toBeNull()
  })
})
