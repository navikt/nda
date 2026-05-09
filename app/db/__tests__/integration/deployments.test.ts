/**
 * Integration test: Deployment SQL queries.
 * Tests insert, query, and update operations on the deployments table.
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { APPROVED_STATUSES_SQL, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
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

describe('deployment queries', () => {
  it('should insert and retrieve a deployment', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Add feature X',
    })

    const { rows } = await pool.query('SELECT * FROM deployments WHERE id = $1', [depId])
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Add feature X')
    expect(rows[0].team_slug).toBe('team-1')
    expect(rows[0].four_eyes_status).toBe('pending')
  })

  it('should enforce unique nais_deployment_id', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at)
       VALUES ($1, 'unique-id-123', 'team-1', 'my-app', 'prod', NOW())`,
      [appId],
    )

    await expect(
      pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at)
         VALUES ($1, 'unique-id-123', 'team-1', 'my-app', 'prod', NOW())`,
        [appId],
      ),
    ).rejects.toThrow(/unique|duplicate/)
  })

  it('should update title with COALESCE (preserving existing value)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Original title',
    })

    // Update with new title
    await pool.query(`UPDATE deployments SET title = COALESCE($2, title) WHERE id = $1`, [depId, 'New title'])
    const { rows: r1 } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    expect(r1[0].title).toBe('New title')

    // Update with null title (should preserve existing)
    await pool.query(`UPDATE deployments SET title = COALESCE($2, title) WHERE id = $1`, [depId, null])
    const { rows: r2 } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    expect(r2[0].title).toBe('New title')
  })

  it('should filter deployments by date range and team', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-1', environment: 'prod' })

    const jan = new Date('2025-01-15T12:00:00Z')
    const feb = new Date('2025-02-15T12:00:00Z')
    const mar = new Date('2025-03-15T12:00:00Z')

    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: jan })
    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: feb })
    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: mar })

    const startDate = new Date('2025-02-01')
    const endDate = new Date('2025-03-01')

    const { rows } = await pool.query(
      `SELECT id FROM deployments
       WHERE team_slug = $1
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at`,
      ['team-a', startDate, endDate],
    )

    expect(rows).toHaveLength(1)
  })

  it('should count deployments using FILTER clause correctly', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'app-x', environment: 'prod' })

    // Insert various four_eyes_status values
    for (const status of ['approved_pr', 'approved_pr', 'direct_push', 'pending']) {
      const naisId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at, four_eyes_status)
         VALUES ($1, $2, 'team-x', 'app-x', 'prod', NOW(), $3)`,
        [appId, naisId, status],
      )
    }

    // This is the exact pattern from getSectionOverallStats that uses four_eyes_status
    const { rows } = await pool.query(`
      SELECT
        COUNT(id)::int AS total,
        COUNT(id) FILTER (WHERE four_eyes_status IN (${APPROVED_STATUSES_SQL}))::int AS with_four_eyes,
        COUNT(id) FILTER (WHERE four_eyes_status IN ('direct_push', 'unverified_commits'))::int AS without_four_eyes,
        COUNT(id) FILTER (WHERE COALESCE(four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL}))::int AS pending
      FROM deployments
      WHERE team_slug = 'team-x'
    `)

    expect(rows[0].total).toBe(4)
    expect(rows[0].with_four_eyes).toBe(2)
    expect(rows[0].without_four_eyes).toBe(1)
    expect(rows[0].pending).toBe(1)
  })
})

describe('title fallback chain (COALESCE)', () => {
  const titleQuery = `
    SELECT
      COALESCE(d.title, d.github_pr_data->>'title', c.original_pr_title, c.message, d.unverified_commits->0->>'message') AS title
    FROM deployments d
    LEFT JOIN commits c ON c.sha = d.commit_sha
      AND c.repo_owner = d.detected_github_owner
      AND c.repo_name = d.detected_github_repo_name
    WHERE d.id = $1
  `

  it('should fall back to github_pr_data title when title is null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      githubPrData: { title: 'PR title from github_pr_data' },
    })

    const { rows } = await pool.query(titleQuery, [depId])
    expect(rows[0].title).toBe('PR title from github_pr_data')
  })

  it('should fall back to commits.original_pr_title when title and github_pr_data are null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const sha = 'abc123fallback'
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas, original_pr_title)
       VALUES ($1, 'navikt', 'my-repo', 'alice', 'commit msg', false, '[]', 'Original PR Title')`,
      [sha],
    )

    const { rows } = await pool.query(titleQuery, [depId])
    expect(rows[0].title).toBe('Original PR Title')
  })

  it('should fall back to commits.message when title, github_pr_data, and original_pr_title are null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const sha = 'def456fallback'
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas)
       VALUES ($1, 'navikt', 'my-repo', 'bob', 'feat: add logging', false, '[]')`,
      [sha],
    )

    const { rows } = await pool.query(titleQuery, [depId])
    expect(rows[0].title).toBe('feat: add logging')
  })

  it('should fall back to unverified_commits first message when all other sources are null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const naisId = `dep-unverified-${Date.now()}`
    const { rows: insertRows } = await pool.query(
      `INSERT INTO deployments (
        monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at,
        unverified_commits
      ) VALUES ($1, $2, 'team-1', 'test-app', 'prod', NOW(), $3::jsonb)
      RETURNING id`,
      [appId, naisId, JSON.stringify([{ sha: 'xyz', message: 'unverified commit msg', author: 'charlie' }])],
    )

    const { rows } = await pool.query(titleQuery, [insertRows[0].id])
    expect(rows[0].title).toBe('unverified commit msg')
  })

  it('should respect priority order: d.title > github_pr_data > original_pr_title > message > unverified', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const sha = 'priority123'
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Explicit title',
      commitSha: sha,
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
      githubPrData: { title: 'PR data title' },
    })

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas, original_pr_title)
       VALUES ($1, 'navikt', 'my-repo', 'dave', 'commit message', false, '[]', 'Original PR title')`,
      [sha],
    )

    // With all sources: d.title wins
    const { rows: r1 } = await pool.query(titleQuery, [depId])
    expect(r1[0].title).toBe('Explicit title')

    // Remove d.title: github_pr_data wins
    await pool.query('UPDATE deployments SET title = NULL WHERE id = $1', [depId])
    const { rows: r2 } = await pool.query(titleQuery, [depId])
    expect(r2[0].title).toBe('PR data title')

    // Remove github_pr_data: commits.original_pr_title wins
    await pool.query('UPDATE deployments SET github_pr_data = NULL WHERE id = $1', [depId])
    const { rows: r3 } = await pool.query(titleQuery, [depId])
    expect(r3[0].title).toBe('Original PR title')

    // Remove original_pr_title: commits.message wins
    await pool.query(
      "UPDATE commits SET original_pr_title = NULL WHERE sha = $1 AND repo_owner = 'navikt' AND repo_name = 'my-repo'",
      [sha],
    )
    const { rows: r4 } = await pool.query(titleQuery, [depId])
    expect(r4[0].title).toBe('commit message')
  })
})

describe('manual approval preserves existing data', () => {
  it('should keep title and github_pr_data when status changes to manually_approved', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Legg til oversetting for AFP Stat kontroll',
      fourEyesStatus: 'unverified_commits',
      githubPrData: { title: 'Legg til oversetting for AFP Stat kontroll', number: 579 },
    })

    // Set unverified_commits JSON
    await pool.query(
      `UPDATE deployments 
       SET github_pr_number = 579,
           github_pr_url = 'https://github.com/navikt/repo/pull/579',
           unverified_commits = $2::jsonb
       WHERE id = $1`,
      [
        depId,
        JSON.stringify([
          { sha: '7de20a1', message: 'Legg til oversetting for AFP Stat kontroll (#579)', author: 'alice' },
        ]),
      ],
    )

    // Simulate manual approval that preserves existing data (the fixed behavior)
    const before = await pool.query('SELECT * FROM deployments WHERE id = $1', [depId])
    const existing = before.rows[0]

    await pool.query(
      `UPDATE deployments 
       SET four_eyes_status = 'manually_approved',
           github_pr_number = $2,
           github_pr_url = $3,
           github_pr_data = $4,
           title = $5,
           unverified_commits = $6
       WHERE id = $1`,
      [
        depId,
        existing.github_pr_number,
        existing.github_pr_url,
        existing.github_pr_data ? JSON.stringify(existing.github_pr_data) : null,
        existing.title,
        existing.unverified_commits ? JSON.stringify(existing.unverified_commits) : null,
      ],
    )

    const { rows } = await pool.query('SELECT * FROM deployments WHERE id = $1', [depId])
    expect(rows[0].four_eyes_status).toBe('manually_approved')
    expect(rows[0].title).toBe('Legg til oversetting for AFP Stat kontroll')
    expect(rows[0].github_pr_number).toBe(579)
    expect(rows[0].github_pr_url).toBe('https://github.com/navikt/repo/pull/579')
    expect(rows[0].github_pr_data).toEqual({ title: 'Legg til oversetting for AFP Stat kontroll', number: 579 })
    expect(rows[0].unverified_commits).toEqual([
      { sha: '7de20a1', message: 'Legg til oversetting for AFP Stat kontroll (#579)', author: 'alice' },
    ])
  })
})

describe('not_approved filter includes unrecognized statuses', () => {
  it('should include deployments with unrecognized four_eyes_status in not_approved filter', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-filter', appName: 'app-filter', environment: 'prod' })

    // Seed deployments with various statuses
    const statuses = ['approved_pr', 'pending', 'direct_push', 'some_unknown_status', null]
    for (const status of statuses) {
      const naisId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at, four_eyes_status)
         VALUES ($1, $2, 'team-filter', 'app-filter', 'prod', NOW(), $3)`,
        [appId, naisId, status],
      )
    }

    // Query using the same exclusion logic as getDeploymentsPaginated
    const { rows } = await pool.query(`
      SELECT d.four_eyes_status
      FROM deployments d
      JOIN monitored_applications ma ON d.monitored_app_id = ma.id
      WHERE d.team_slug = 'team-filter'
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${APPROVED_STATUSES_SQL})
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${PENDING_STATUSES_SQL})
      ORDER BY d.four_eyes_status
    `)

    // Should include direct_push and the unknown status
    expect(rows).toHaveLength(2)
    const statuses_found = rows.map((r: { four_eyes_status: string | null }) => r.four_eyes_status)
    expect(statuses_found).toContain('direct_push')
    expect(statuses_found).toContain('some_unknown_status')
  })

  it('should NOT include NULL status in not_approved (NULL → unknown → pending)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-null', appName: 'app-null', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at, four_eyes_status)
       VALUES ($1, 'dep-null-1', 'team-null', 'app-null', 'prod', NOW(), NULL)`,
      [appId],
    )

    const { rows } = await pool.query(`
      SELECT d.four_eyes_status
      FROM deployments d
      WHERE d.team_slug = 'team-null'
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${APPROVED_STATUSES_SQL})
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${PENDING_STATUSES_SQL})
    `)

    // NULL coalesces to 'unknown' which is in PENDING_STATUSES, so excluded from not_approved
    expect(rows).toHaveLength(0)
  })
})
