import { pool } from '~/db/connection.server'
import { computeChecksPassed, mapRawCheckRunToCheckRun, type RawCheckRun } from '~/lib/github/checks-snapshot'
import type { CheckRun } from '~/lib/github/pr/checks.server'
import type { ApiVersionMetadata } from '~/lib/github/pr-snapshot'
import type { ChecksRawSnapshot } from '~/lib/verification/types'

export async function saveChecksRawSnapshot(
  owner: string,
  repo: string,
  githubRepoId: number,
  sha: string,
  checkSuiteId: number | null,
  isDefinitive: boolean,
  rawCheckRuns: RawCheckRun[],
  apiVersion: ApiVersionMetadata,
  observedAt: Date,
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_checks_raw_snapshots
       (github_repo_id, owner, repo, sha, check_suite_id, is_definitive, api_version, api_deprecated_at, api_sunset_at, fetched_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      githubRepoId,
      owner,
      repo,
      sha,
      checkSuiteId,
      isDefinitive,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      observedAt,
      JSON.stringify(rawCheckRuns),
    ],
  )
  return result.rows[0].id
}

export async function getLatestDefinitiveChecksRawSnapshot(
  owner: string,
  repo: string,
  sha: string,
  checkSuiteId: number | null = null,
): Promise<ChecksRawSnapshot | null> {
  const result = await pool.query(
    `SELECT id, owner, repo, github_repo_id, sha, check_suite_id, is_definitive,
            api_version, api_deprecated_at, api_sunset_at, fetched_at, data
     FROM github_checks_raw_snapshots
     WHERE owner = $1 AND repo = $2 AND sha = $3
       AND check_suite_id IS NOT DISTINCT FROM $4
       AND github_repo_id = (
         SELECT github_repo_id
         FROM github_checks_raw_snapshots
         WHERE owner = $1 AND repo = $2 AND sha = $3
           AND check_suite_id IS NOT DISTINCT FROM $4
         ORDER BY fetched_at DESC
         LIMIT 1
       )
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, sha, checkSuiteId],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  // Only the absolute latest snapshot for this repo/SHA/suite is eligible for reuse: if it isn't
  // definitive yet, an older definitive row would be stale (GitHub's result is still changing).
  if (!row.is_definitive) {
    return null
  }

  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    githubRepoId: Number(row.github_repo_id),
    sha: row.sha,
    checkSuiteId: row.check_suite_id === null ? null : Number(row.check_suite_id),
    isDefinitive: row.is_definitive,
    apiVersion: row.api_version,
    apiDeprecatedAt: row.api_deprecated_at ? new Date(row.api_deprecated_at).toISOString() : null,
    apiSunsetAt: row.api_sunset_at ? new Date(row.api_sunset_at).toISOString() : null,
    fetchedAt: row.fetched_at,
    data: row.data,
  }
}

export async function getDerivedChecksDataFromRawSnapshot(
  owner: string,
  repo: string,
  sha: string,
  checkSuiteId: number | null = null,
): Promise<{ checks_passed: boolean | null; checks: CheckRun[] } | null> {
  const rawSnapshot = await getLatestDefinitiveChecksRawSnapshot(owner, repo, sha, checkSuiteId)
  if (!rawSnapshot) return null
  try {
    const rawCheckRuns = rawSnapshot.data as RawCheckRun[]
    return {
      checks_passed: computeChecksPassed(rawCheckRuns),
      checks: rawCheckRuns.map(mapRawCheckRunToCheckRun),
    }
  } catch {
    return null
  }
}
