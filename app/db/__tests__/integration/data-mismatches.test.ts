/**
 * Integration tests: data-mismatches admin page queries.
 * 1. Title-missing summary query — validates FILTER aggregate syntax
 * 2. Baseline-without-approver query — validates detection of NULL changed_by
 * 3. Comments missing registered_by query — validates detection of NULL registered_by
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

// This is the exact query from the title-mismatches route loader.
// Keep in sync with the MissingSummary pool.query() in app/routes/admin/data-mismatches.tsx.
const FIXED_SUMMARY_SQL = `SELECT
  (COUNT(*) FILTER (WHERE d.title IS NULL))::int AS total_missing,
  (COUNT(*) FILTER (
    WHERE d.title IS NULL
      AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \\t\\r\\n'), '') != ''
  ))::int AS with_pr_data,
  (COUNT(*) FILTER (
    WHERE d.title IS NULL
      AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \\t\\r\\n'), '') = ''
      AND d.unverified_commits IS NOT NULL
      AND jsonb_array_length(d.unverified_commits) > 0
      AND COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\\n', 1), E' \\t\\r\\n'), '') != ''
  ))::int AS with_unverified_commits,
  (COUNT(*) FILTER (
    WHERE d.title IS NULL
      AND COALESCE(BTRIM(d.github_pr_data->>'title', E' \\t\\r\\n'), '') = ''
      AND (d.unverified_commits IS NULL
           OR jsonb_array_length(d.unverified_commits) = 0
           OR COALESCE(BTRIM(SPLIT_PART(d.unverified_commits->0->>'message', E'\\n', 1), E' \\t\\r\\n'), '') = '')
  ))::int AS no_fallback
  FROM deployments d`

// The broken query before the fix — cast before FILTER is invalid SQL
const BROKEN_SUMMARY_SQL = `SELECT
  COUNT(*)::int FILTER (WHERE d.title IS NULL) AS total_missing,
  COUNT(*)::int FILTER (WHERE d.title IS NULL AND d.github_pr_data IS NOT NULL AND d.github_pr_data->>'title' IS NOT NULL) AS with_pr_data,
  COUNT(*)::int FILTER (WHERE d.title IS NULL AND (d.github_pr_data IS NULL OR d.github_pr_data->>'title' IS NULL) AND d.unverified_commits IS NOT NULL AND jsonb_array_length(d.unverified_commits) > 0) AS with_unverified_commits,
  COUNT(*)::int FILTER (WHERE d.title IS NULL AND (d.github_pr_data IS NULL OR d.github_pr_data->>'title' IS NULL) AND (d.unverified_commits IS NULL OR jsonb_array_length(d.unverified_commits) = 0)) AS no_fallback
FROM deployments d`

const BASELINE_NO_APPROVER_SQL = `SELECT
  d.id,
  ma.app_name,
  ma.team_slug,
  ma.environment_name,
  d.created_at AS deployed_at
FROM deployments d
JOIN monitored_applications ma ON d.monitored_app_id = ma.id
WHERE d.four_eyes_status = 'baseline'
  AND NOT EXISTS (
    SELECT 1 FROM deployment_status_history dsh
    WHERE dsh.deployment_id = d.id
      AND dsh.change_source = 'baseline_approval'
      AND dsh.changed_by IS NOT NULL
  )
ORDER BY d.created_at DESC`

describe('data-mismatches: title missing summary query', () => {
  it('broken syntax (regression): COUNT(*)::int FILTER is invalid SQL', async () => {
    await expect(pool.query(BROKEN_SUMMARY_SQL)).rejects.toThrow('syntax error at or near "FILTER"')
  })

  it('should execute without syntax errors', async () => {
    const { rows } = await pool.query(FIXED_SUMMARY_SQL)
    expect(rows).toHaveLength(1)
    expect(rows[0].total_missing).toBe(0)
  })

  it('should count deployments with missing titles correctly', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    // Deployment with title
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      title: 'Has title',
    })

    // Deployment with missing title but has PR data
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      title: undefined,
      githubPrData: { title: 'PR title' },
    })

    // Deployment with missing title and no fallback
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      title: undefined,
    })

    const { rows } = await pool.query(FIXED_SUMMARY_SQL)
    expect(rows[0].total_missing).toBe(2)
    expect(rows[0].with_pr_data).toBe(1)
    expect(rows[0].no_fallback).toBe(1)
  })

  it('whitespace-only PR title counts as no_fallback, not with_pr_data', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team', appName: 'app', environment: 'prod' })

    // Whitespace-only PR title — should NOT count as with_pr_data
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team',
      environment: 'prod',
      title: undefined,
      githubPrData: { title: '   \r\n  ' },
    })

    const { rows } = await pool.query(FIXED_SUMMARY_SQL)
    expect(rows[0].total_missing).toBe(1)
    expect(rows[0].with_pr_data).toBe(0)
    expect(rows[0].no_fallback).toBe(1)
  })
})

describe('baseline-without-approver query', () => {
  it('returns empty when all baselines have an approver in status history', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      fourEyesStatus: 'baseline',
    })

    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, created_at)
       VALUES ($1, 'pending_baseline', 'baseline', 'Z990001', 'baseline_approval', NOW())`,
      [deploymentId],
    )

    const { rows } = await pool.query(BASELINE_NO_APPROVER_SQL)
    expect(rows).toHaveLength(0)
  })

  it('returns baseline deployments missing an approver in status history', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })

    // Baseline without any history row — represents pre-#200 approvals
    const missingId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod-gcp',
      fourEyesStatus: 'baseline',
    })

    // Baseline with a history row but changed_by is NULL
    const nullApproverId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod-gcp',
      fourEyesStatus: 'baseline',
    })
    await pool.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, created_at)
       VALUES ($1, 'pending_baseline', 'baseline', NULL, 'baseline_approval', NOW())`,
      [nullApproverId],
    )

    const { rows } = await pool.query(BASELINE_NO_APPROVER_SQL)
    const ids = rows.map((r: { id: number }) => r.id)
    expect(ids).toContain(missingId)
    expect(ids).toContain(nullApproverId)
    expect(rows).toHaveLength(2)
  })
})

const COMMENTS_MISSING_REGISTERED_BY_SQL = `SELECT
  dc.id AS comment_id,
  dc.deployment_id,
  ma.app_name,
  ma.team_slug,
  ma.environment_name,
  dc.comment_type,
  dc.created_at
FROM deployment_comments dc
JOIN deployments d ON dc.deployment_id = d.id
JOIN monitored_applications ma ON d.monitored_app_id = ma.id
WHERE dc.registered_by IS NULL
  AND dc.deleted_at IS NULL
ORDER BY dc.created_at DESC`

describe('data-mismatches: comments missing registered_by', () => {
  it('returns empty when all comments have registered_by set', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
    })

    await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_text, comment_type, registered_by)
       VALUES ($1, 'En kommentar', 'comment', 'Z990001')`,
      [deploymentId],
    )

    const { rows } = await pool.query(COMMENTS_MISSING_REGISTERED_BY_SQL)
    expect(rows).toHaveLength(0)
  })

  it('returns comments where registered_by IS NULL', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod-gcp',
    })

    await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_text, comment_type, registered_by)
       VALUES ($1, 'Gammel kommentar uten forfatter', 'comment', NULL)`,
      [deploymentId],
    )

    const { rows } = await pool.query(COMMENTS_MISSING_REGISTERED_BY_SQL)
    expect(rows).toHaveLength(1)
    expect(rows[0].team_slug).toBe('team-b')
    expect(rows[0].app_name).toBe('app-b')
  })

  it('excludes soft-deleted comments', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-c', appName: 'app-c', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod-gcp',
    })

    await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_text, comment_type, registered_by, deleted_at)
       VALUES ($1, 'Slettet kommentar', 'comment', NULL, NOW())`,
      [deploymentId],
    )

    const { rows } = await pool.query(COMMENTS_MISSING_REGISTERED_BY_SQL)
    expect(rows).toHaveLength(0)
  })

  it('returns app_name, team_slug, environment_name from joined tables', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-d', appName: 'app-d', environment: 'dev-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'dev-gcp',
    })

    await pool.query(
      `INSERT INTO deployment_comments (deployment_id, comment_text, comment_type, registered_by)
       VALUES ($1, 'Test', 'comment', NULL)`,
      [deploymentId],
    )

    const { rows } = await pool.query(COMMENTS_MISSING_REGISTERED_BY_SQL)
    expect(rows).toHaveLength(1)
    expect(rows[0].app_name).toBe('app-d')
    expect(rows[0].team_slug).toBe('team-d')
    expect(rows[0].environment_name).toBe('dev-gcp')
    expect(rows[0].deployment_id).toBe(deploymentId)
  })
})
