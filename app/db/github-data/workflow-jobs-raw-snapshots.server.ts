import { pool } from '~/db/connection.server'
import type { ApiVersionMetadata } from '~/lib/github/pr-snapshot'
import type { WorkflowJobsRawSnapshot } from '~/lib/verification/types'

export async function saveWorkflowJobsRawSnapshot(
  owner: string,
  repo: string,
  githubRepoId: number | string,
  runId: number,
  attemptNumber: number | null,
  jobs: unknown[],
  apiVersion: ApiVersionMetadata,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_workflow_jobs_raw_snapshots
       (github_repo_id, owner, repo, run_id, attempt_number, api_version, api_deprecated_at, api_sunset_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      githubRepoId,
      owner,
      repo,
      runId,
      attemptNumber,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(jobs),
    ],
  )
  return result.rows[0].id
}

export async function getLatestWorkflowJobsRawSnapshot(
  githubRepoId: number | string,
  runId: number,
  attemptNumber: number | null,
): Promise<WorkflowJobsRawSnapshot | null> {
  const result = await pool.query(
    `SELECT id, owner, repo, github_repo_id, run_id, attempt_number,
            api_version, api_deprecated_at, api_sunset_at, fetched_at, data
     FROM github_workflow_jobs_raw_snapshots
     WHERE github_repo_id = $1 AND run_id = $2
       AND attempt_number IS NOT DISTINCT FROM $3::integer
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [githubRepoId, runId, attemptNumber],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    githubRepoId: Number(row.github_repo_id),
    runId: Number(row.run_id),
    attemptNumber: row.attempt_number,
    apiVersion: row.api_version,
    apiDeprecatedAt: row.api_deprecated_at ? new Date(row.api_deprecated_at).toISOString() : null,
    apiSunsetAt: row.api_sunset_at ? new Date(row.api_sunset_at).toISOString() : null,
    fetchedAt: row.fetched_at,
    data: row.data,
  }
}
