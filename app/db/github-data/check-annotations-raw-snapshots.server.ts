import { pool } from '~/db/connection.server'
import type { ApiVersionMetadata } from '~/lib/github/pr-snapshot'
import type { CheckAnnotationsRawSnapshot } from '~/lib/verification/types'

export async function saveCheckAnnotationsRawSnapshot(
  owner: string,
  repo: string,
  githubRepoId: number,
  checkRunId: number,
  rawData: unknown,
  apiVersion: ApiVersionMetadata,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_check_annotations_raw_snapshots
       (github_repo_id, owner, repo, check_run_id, api_version, api_deprecated_at, api_sunset_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      githubRepoId,
      owner,
      repo,
      checkRunId,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawData),
    ],
  )
  return result.rows[0].id
}

export async function getLatestCheckAnnotationsRawSnapshot(
  owner: string,
  repo: string,
  checkRunId: number,
): Promise<CheckAnnotationsRawSnapshot | null> {
  const result = await pool.query(
    `SELECT id, owner, repo, github_repo_id, check_run_id, api_version, api_deprecated_at, api_sunset_at, fetched_at, data
     FROM github_check_annotations_raw_snapshots
     WHERE owner = $1 AND repo = $2 AND check_run_id = $3
       AND github_repo_id = (
         SELECT github_repo_id
         FROM github_check_annotations_raw_snapshots
         WHERE owner = $1 AND repo = $2 AND check_run_id = $3
         ORDER BY fetched_at DESC
         LIMIT 1
       )
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, checkRunId],
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
    checkRunId: Number(row.check_run_id),
    apiVersion: row.api_version,
    apiDeprecatedAt: row.api_deprecated_at ? new Date(row.api_deprecated_at).toISOString() : null,
    apiSunsetAt: row.api_sunset_at ? new Date(row.api_sunset_at).toISOString() : null,
    fetchedAt: row.fetched_at,
    data: row.data,
  }
}
