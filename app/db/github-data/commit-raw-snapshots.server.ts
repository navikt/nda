import { pool } from '~/db/connection.server'
import type { ApiVersionMetadata } from '~/lib/github/pr-snapshot'
import type { CommitRawSnapshot } from '~/lib/verification/types'

export async function saveCommitRawSnapshot(
  owner: string,
  repo: string,
  githubRepoId: number,
  sha: string,
  rawData: unknown,
  apiVersion: ApiVersionMetadata,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_commit_raw_snapshots
       (github_repo_id, owner, repo, sha, api_version, api_deprecated_at, api_sunset_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      githubRepoId,
      owner,
      repo,
      sha,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawData),
    ],
  )
  return result.rows[0].id
}

export async function getLatestCommitRawSnapshot(
  owner: string,
  repo: string,
  sha: string,
): Promise<CommitRawSnapshot | null> {
  const result = await pool.query(
    `SELECT id, owner, repo, github_repo_id, sha, api_version, api_deprecated_at, api_sunset_at, fetched_at, data
     FROM github_commit_raw_snapshots
     WHERE owner = $1 AND repo = $2 AND sha = $3
       AND github_repo_id = (
         SELECT github_repo_id
         FROM github_commit_raw_snapshots
         WHERE owner = $1 AND repo = $2 AND sha = $3
         ORDER BY fetched_at DESC
         LIMIT 1
       )
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, sha],
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
    sha: row.sha,
    apiVersion: row.api_version,
    apiDeprecatedAt: row.api_deprecated_at ? new Date(row.api_deprecated_at).toISOString() : null,
    apiSunsetAt: row.api_sunset_at ? new Date(row.api_sunset_at).toISOString() : null,
    fetchedAt: row.fetched_at,
    data: row.data,
  }
}
