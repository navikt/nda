import { pool } from '~/db/connection.server'
import type { ApiVersionMetadata } from '~/lib/github/pr-snapshot'
import type { WorkflowRunRawSnapshot } from '~/lib/verification/types'

export async function saveWorkflowRunRawSnapshot(
  owner: string,
  repo: string,
  githubRepoId: number | string,
  runId: number,
  rawData: unknown,
  apiVersion: ApiVersionMetadata,
): Promise<number> {
  const runAttempt =
    rawData && typeof rawData === 'object' && 'run_attempt' in rawData && typeof rawData.run_attempt === 'number'
      ? rawData.run_attempt
      : null
  const result = await pool.query(
    `INSERT INTO github_workflow_runs_raw_snapshots
       (github_repo_id, owner, repo, run_id, run_attempt, api_version, api_deprecated_at, api_sunset_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      githubRepoId,
      owner,
      repo,
      runId,
      runAttempt,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawData),
    ],
  )
  return result.rows[0].id
}

export async function hasWorkflowRunRawSnapshot(githubRepoId: number | string, runId: number): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM github_workflow_runs_raw_snapshots
       WHERE github_repo_id = $1 AND run_id = $2
     ) AS exists`,
    [githubRepoId, runId],
  )
  return result.rows[0].exists
}

export async function getWorkflowRunRawSnapshotData(
  githubRepoId: number | string,
  runId: number,
  runAttempt?: number,
): Promise<unknown | null> {
  const result = await pool.query<{ data: unknown }>(
    `SELECT data
     FROM github_workflow_runs_raw_snapshots
     WHERE github_repo_id = $1 AND run_id = $2
       AND ($3::bigint IS NULL OR run_attempt = $3)
     ORDER BY run_attempt DESC NULLS LAST, fetched_at DESC
     LIMIT 1`,
    [githubRepoId, runId, runAttempt ?? null],
  )
  return result.rows[0]?.data ?? null
}

export async function hasRecentWorkflowRunAttemptShaFailure(
  githubRepoId: number | string,
  runId: number,
  runAttempt: number,
): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM github_workflow_run_attempt_sha_failures
       WHERE github_repo_id = $1
         AND run_id = $2
         AND run_attempt = $3
         AND checked_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
     ) AS exists`,
    [githubRepoId, runId, runAttempt],
  )
  return result.rows[0].exists
}

export async function recordWorkflowRunAttemptShaFailure(
  githubRepoId: number | string,
  runId: number,
  runAttempt: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO github_workflow_run_attempt_sha_failures (github_repo_id, run_id, run_attempt)
     VALUES ($1, $2, $3)
     ON CONFLICT (github_repo_id, run_id, run_attempt)
     DO UPDATE SET checked_at = CURRENT_TIMESTAMP`,
    [githubRepoId, runId, runAttempt],
  )
}

export async function getLatestWorkflowRunRawSnapshot(
  owner: string,
  repo: string,
  runId: number,
): Promise<WorkflowRunRawSnapshot | null> {
  const result = await pool.query(
    `SELECT id, owner, repo, github_repo_id, run_id, api_version, api_deprecated_at, api_sunset_at, fetched_at, data
     FROM github_workflow_runs_raw_snapshots
     WHERE owner = $1 AND repo = $2 AND run_id = $3
       AND github_repo_id = (
         SELECT github_repo_id
         FROM github_workflow_runs_raw_snapshots
         WHERE owner = $1 AND repo = $2 AND run_id = $3
         ORDER BY run_attempt DESC NULLS LAST, fetched_at DESC
         LIMIT 1
       )
     ORDER BY run_attempt DESC NULLS LAST, fetched_at DESC
     LIMIT 1`,
    [owner, repo, runId],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    githubRepoId: Number(row.github_repo_id),
    runId: Number(row.run_id),
    apiVersion: row.api_version,
    apiDeprecatedAt: row.api_deprecated_at ? new Date(row.api_deprecated_at).toISOString() : null,
    apiSunsetAt: row.api_sunset_at ? new Date(row.api_sunset_at).toISOString() : null,
    fetchedAt: row.fetched_at,
    data: row.data,
  }
}
