import { pool } from '~/db/connection.server'
import { saveRawSnapshotWithLock } from '~/db/github-data/raw-snapshot-lock.server'
import { WORKFLOW_RUN_RAW_SNAPSHOT_LOCK_NAMESPACE } from '~/db/github-data/raw-snapshot-lock-namespaces.server'
import type { ApiVersionMetadata } from '~/lib/github/pr-snapshot'
import type { WorkflowRunRawSnapshot } from '~/lib/verification/types'

export async function saveWorkflowRunRawSnapshot(
  owner: string,
  repo: string,
  githubRepoId: number,
  runId: number,
  rawData: unknown,
  apiVersion: ApiVersionMetadata,
): Promise<number> {
  return saveRawSnapshotWithLock(
    WORKFLOW_RUN_RAW_SNAPSHOT_LOCK_NAMESPACE,
    `${githubRepoId}:${runId}`,
    `WITH last_snapshot AS (
       SELECT id, data
       FROM github_workflow_runs_raw_snapshots
       WHERE github_repo_id = $1 AND run_id = $4
       ORDER BY fetched_at DESC
       LIMIT 1
     ),
     inserted AS (
       INSERT INTO github_workflow_runs_raw_snapshots
         (github_repo_id, owner, repo, run_id, api_version, api_deprecated_at, api_sunset_at, data)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM last_snapshot WHERE data = $8::jsonb)
       RETURNING id
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id FROM last_snapshot WHERE NOT EXISTS (SELECT 1 FROM inserted)`,
    [
      githubRepoId,
      owner,
      repo,
      runId,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawData),
    ],
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
         ORDER BY fetched_at DESC
         LIMIT 1
       )
     ORDER BY fetched_at DESC
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
