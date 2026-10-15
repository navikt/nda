/**
 * Integration test for backfill-wiped-titles-from-snapshots migration.
 *
 * Verifies all three fallback steps restore titles for manually_approved
 * deployments that lost metadata, and that existing titles are never overwritten.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

const MIGRATION_SQL = readFileSync(
  resolve(__dirname, '../../migrations/1773300000000_backfill-wiped-titles-from-snapshots.sql'),
  'utf-8',
)

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

/** Insert a commit row and return the sha. */
async function seedCommit(opts: {
  sha: string
  owner: string
  repo: string
  message?: string | null
  originalPrTitle?: string | null
  originalPrNumber?: number | null
}): Promise<string> {
  await pool.query(
    `INSERT INTO commits (sha, repo_owner, repo_name, message, original_pr_title, original_pr_number, parent_shas, is_merge_commit)
     VALUES ($1, $2, $3, $4, $5, $6, '[]', false)`,
    [
      opts.sha,
      opts.owner,
      opts.repo,
      opts.message ?? null,
      opts.originalPrTitle ?? null,
      opts.originalPrNumber ?? null,
    ],
  )
  return opts.sha
}

/** Insert a github_pr_snapshots metadata row and return its id. */
async function seedPrSnapshot(opts: { owner: string; repo: string; prNumber: number; title: string }): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO github_pr_snapshots (owner, repo, pr_number, data_type, schema_version, data)
     VALUES ($1, $2, $3, 'metadata', 1, $4::jsonb)
     RETURNING id`,
    [opts.owner, opts.repo, opts.prNumber, JSON.stringify({ title: opts.title, number: opts.prNumber })],
  )
  return rows[0].id
}

/** Insert a verification_runs row linking snapshot ids. */
async function seedVerificationRun(deploymentId: number, prSnapshotIds: number[]): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO verification_runs (deployment_id, schema_version, pr_snapshot_ids, commit_snapshot_ids, result, status)
     VALUES ($1, 1, $2, '{}', '{"status":"approved"}'::jsonb, 'approved')
     RETURNING id`,
    [deploymentId, prSnapshotIds],
  )
  return rows[0].id
}

describe('backfill wiped titles migration', () => {
  test('Step 1: restores title from commits table (original_pr_title)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'aaa1111111111111111111111111111111111111'
    await seedCommit({ sha, owner: 'navikt', repo: 'my-repo', originalPrTitle: 'Add feature X', message: 'commit msg' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
      title: undefined, // NULL — wiped by bug
    })

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title FROM deployments WHERE commit_sha = $1', [sha])
    expect(rows[0].title).toBe('Add feature X')
  })

  test('Step 1: falls back to commit message when original_pr_title is NULL', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'bbb2222222222222222222222222222222222222'
    await seedCommit({ sha, owner: 'navikt', repo: 'my-repo', message: 'Direct push commit msg' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
    })

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title FROM deployments WHERE commit_sha = $1', [sha])
    expect(rows[0].title).toBe('Direct push commit msg')
  })

  test('Step 2: restores title from PR snapshots via verification_runs', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'ccc3333333333333333333333333333333333333'
    // No commit in commits table — Step 1 won't match
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })

    const snapshotId = await seedPrSnapshot({
      owner: 'navikt',
      repo: 'my-repo',
      prNumber: 42,
      title: 'PR title from snapshot',
    })
    await seedVerificationRun(depId, [snapshotId])

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title, github_pr_number, github_pr_url FROM deployments WHERE id = $1', [
      depId,
    ])
    expect(rows[0].title).toBe('PR title from snapshot')
    expect(rows[0].github_pr_number).toBe(42)
    expect(rows[0].github_pr_url).toBe('https://github.com/navikt/my-repo/pull/42')
  })

  test('Step 3: restores title from PR snapshots via commits.original_pr_number', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'ddd4444444444444444444444444444444444444'
    // Commit exists but has no message or pr_title (Step 1 won't match)
    await seedCommit({
      sha,
      owner: 'navikt',
      repo: 'my-repo',
      message: null,
      originalPrTitle: null,
      originalPrNumber: 99,
    })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })
    // No verification_runs — Step 2 won't match
    // But there's a snapshot for PR #99
    await seedPrSnapshot({ owner: 'navikt', repo: 'my-repo', prNumber: 99, title: 'PR #99 title via commit link' })

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title, github_pr_number, github_pr_url FROM deployments WHERE id = $1', [
      depId,
    ])
    expect(rows[0].title).toBe('PR #99 title via commit link')
    expect(rows[0].github_pr_number).toBe(99)
    expect(rows[0].github_pr_url).toBe('https://github.com/navikt/my-repo/pull/99')
  })

  test('does NOT overwrite existing title', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'eee5555555555555555555555555555555555555'
    await seedCommit({ sha, owner: 'navikt', repo: 'my-repo', message: 'Commit message that should NOT replace title' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
      title: 'Existing title that must be preserved',
    })

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title FROM deployments WHERE commit_sha = $1', [sha])
    expect(rows[0].title).toBe('Existing title that must be preserved')
  })

  test('does NOT update non-manually_approved deployments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'fff6666666666666666666666666666666666666'
    await seedCommit({ sha, owner: 'navikt', repo: 'my-repo', message: 'Should not be used' })

    for (const status of ['pending', 'approved', 'unverified_commits', 'direct_push', 'error']) {
      await seedDeployment(pool, {
        monitoredAppId: appId,
        teamSlug: 'team-1',
        environment: 'prod',
        commitSha: sha,
        fourEyesStatus: status,
        // title is NULL
      })
    }

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query(
      "SELECT four_eyes_status, title FROM deployments WHERE commit_sha = $1 AND four_eyes_status != 'manually_approved'",
      [sha],
    )
    for (const row of rows) {
      expect(row.title).toBeNull()
    }
  })

  test('Step 2 does NOT overwrite existing github_pr_number', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'ggg7777777777777777777777777777777777777'
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })
    // Set github_pr_number but leave title NULL (partial wipe scenario)
    await pool.query('UPDATE deployments SET github_pr_number = 100, github_pr_url = $2 WHERE id = $1', [
      depId,
      'https://github.com/navikt/my-repo/pull/100',
    ])

    const snapshotId = await seedPrSnapshot({
      owner: 'navikt',
      repo: 'my-repo',
      prNumber: 42,
      title: 'Snapshot PR title',
    })
    await seedVerificationRun(depId, [snapshotId])

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title, github_pr_number, github_pr_url FROM deployments WHERE id = $1', [
      depId,
    ])
    expect(rows[0].title).toBe('Snapshot PR title')
    // COALESCE preserves existing values
    expect(rows[0].github_pr_number).toBe(100)
    expect(rows[0].github_pr_url).toBe('https://github.com/navikt/my-repo/pull/100')
  })

  test('priority order: Step 1 wins over Step 2 and 3', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'hhh8888888888888888888888888888888888888'
    await seedCommit({
      sha,
      owner: 'navikt',
      repo: 'my-repo',
      originalPrTitle: 'Title from commits table',
      originalPrNumber: 50,
    })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })

    // Also seed snapshot data (Step 2 and 3 sources)
    const snapshotId = await seedPrSnapshot({
      owner: 'navikt',
      repo: 'my-repo',
      prNumber: 50,
      title: 'Title from snapshot',
    })
    await seedVerificationRun(depId, [snapshotId])

    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    // Step 1 should have run first, so commits table title wins
    expect(rows[0].title).toBe('Title from commits table')
  })

  test('is idempotent — running twice produces same result', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'app-1', environment: 'prod' })
    const sha = 'iii9999999999999999999999999999999999999'
    await seedCommit({ sha, owner: 'navikt', repo: 'my-repo', message: 'Idempotent title' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      fourEyesStatus: 'manually_approved',
    })

    await pool.query(MIGRATION_SQL)
    await pool.query(MIGRATION_SQL)

    const { rows } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    expect(rows[0].title).toBe('Idempotent title')
  })
})
