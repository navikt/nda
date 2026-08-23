import { pool } from '~/db/connection.server'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import { type CompareData, type CompareSnapshot, CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'

export async function saveCompareSnapshot(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  data: CompareData,
  options?: {
    source?: 'github' | 'cached'
    githubAvailable?: boolean
  },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_compare_snapshots 
       (owner, repo, base_sha, head_sha, schema_version, data, source, github_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      owner,
      repo,
      baseSha,
      headSha,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(data),
      options?.source ?? 'github',
      options?.githubAvailable ?? true,
    ],
  )
  return result.rows[0].id
}

export async function getLatestCompareSnapshot(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  options?: {
    requireCurrentSchema?: boolean
  },
): Promise<CompareSnapshot | null> {
  const requireCurrent = options?.requireCurrentSchema ?? true

  const result = await pool.query(
    `SELECT id, owner, repo, base_sha, head_sha, schema_version, 
            fetched_at, source, github_available, data
     FROM github_compare_snapshots
     WHERE owner = $1 AND repo = $2 AND base_sha = $3 AND head_sha = $4
       ${requireCurrent ? `AND schema_version = ${CURRENT_SCHEMA_VERSION}` : ''}
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, baseSha, headSha],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    baseSha: row.base_sha,
    headSha: row.head_sha,
    schemaVersion: row.schema_version,
    fetchedAt: row.fetched_at,
    source: row.source,
    githubAvailable: row.github_available,
    data: row.data,
  }
}

interface GitHubDataStats {
  total: number
  withCurrentData: number
  withOutdatedData: number
  withoutData: number
}

export async function getGitHubDataStatsForApp(
  appId: number,
  auditStartYear?: number | null,
): Promise<GitHubDataStats> {
  const params: (number | string)[] = [appId]
  let dateFilter = ''
  if (auditStartYear) {
    dateFilter = ` AND d.created_at >= $2`
    params.push(`${auditStartYear}-01-01`)
  }

  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(gcs.id) FILTER (WHERE gcs.schema_version >= ${CURRENT_SCHEMA_VERSION})::int AS with_current,
       COUNT(gcs.id) FILTER (WHERE gcs.schema_version < ${CURRENT_SCHEMA_VERSION})::int AS with_outdated,
       (COUNT(*) - COUNT(gcs.id))::int AS without_data
     FROM deployments d
     LEFT JOIN LATERAL (
       SELECT gcs2.id, gcs2.schema_version
       FROM github_commit_snapshots gcs2
       WHERE gcs2.owner = d.detected_github_owner
         AND gcs2.repo = d.detected_github_repo_name
         AND gcs2.sha = d.commit_sha
         AND gcs2.data_type = 'prs'
       ORDER BY gcs2.fetched_at DESC
       LIMIT 1
     ) gcs ON true
     WHERE d.monitored_app_id = $1
       AND d.commit_sha IS NOT NULL
       AND d.detected_github_owner IS NOT NULL
       AND d.detected_github_repo_name IS NOT NULL
       AND ${VALID_COMMIT_SHA_SQL}
       ${dateFilter}`,
    params,
  )

  const row = result.rows[0]
  return {
    total: row.total,
    withCurrentData: row.with_current,
    withOutdatedData: row.with_outdated,
    withoutData: row.without_data,
  }
}
