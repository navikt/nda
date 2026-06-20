import { pool } from '~/db/connection.server'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import {
  type CommitDataType,
  type CommitSnapshot,
  type CompareData,
  type CompareSnapshot,
  CURRENT_SCHEMA_VERSION,
  type PrDataType,
  type PrSnapshot,
} from '~/lib/verification/types'

async function savePrSnapshot(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
  data: unknown,
  options?: {
    source?: 'github' | 'cached'
    githubAvailable?: boolean
  },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_pr_snapshots 
       (owner, repo, pr_number, data_type, schema_version, data, source, github_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      owner,
      repo,
      prNumber,
      dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(data),
      options?.source ?? 'github',
      options?.githubAvailable ?? true,
    ],
  )
  return result.rows[0].id
}

async function getLatestPrSnapshot(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
  options?: {
    requireCurrentSchema?: boolean
  },
): Promise<PrSnapshot | null> {
  const requireCurrent = options?.requireCurrentSchema ?? true

  const result = await pool.query(
    `SELECT id, owner, repo, pr_number, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_pr_snapshots
     WHERE owner = $1 AND repo = $2 AND pr_number = $3 AND data_type = $4
       ${requireCurrent ? `AND schema_version = ${CURRENT_SCHEMA_VERSION}` : ''}
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, prNumber, dataType],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    prNumber: row.pr_number,
    dataType: row.data_type,
    schemaVersion: row.schema_version,
    fetchedAt: row.fetched_at,
    source: row.source,
    githubAvailable: row.github_available,
    data: row.data,
  }
}

async function _getPrSnapshotHistory(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
  options?: {
    limit?: number
  },
): Promise<PrSnapshot[]> {
  const limit = options?.limit ?? 100

  const result = await pool.query(
    `SELECT id, owner, repo, pr_number, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_pr_snapshots
     WHERE owner = $1 AND repo = $2 AND pr_number = $3 AND data_type = $4
     ORDER BY fetched_at DESC
     LIMIT $5`,
    [owner, repo, prNumber, dataType, limit],
  )

  return result.rows.map(
    (row: {
      id: number
      owner: string
      repo: string
      pr_number: number
      data_type: string
      schema_version: number
      fetched_at: Date
      source: string
      github_available: boolean
      data: unknown
    }) => ({
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      prNumber: row.pr_number,
      dataType: row.data_type as PrDataType,
      schemaVersion: row.schema_version,
      fetchedAt: row.fetched_at,
      source: row.source as 'github' | 'cached',
      githubAvailable: row.github_available,
      data: row.data,
    }),
  )
}

export async function getAllLatestPrSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Map<PrDataType, PrSnapshot>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (data_type) 
            id, owner, repo, pr_number, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_pr_snapshots
     WHERE owner = $1 AND repo = $2 AND pr_number = $3
       AND schema_version = $4
     ORDER BY data_type, fetched_at DESC`,
    [owner, repo, prNumber, CURRENT_SCHEMA_VERSION],
  )

  const snapshots = new Map<PrDataType, PrSnapshot>()
  for (const row of result.rows) {
    snapshots.set(row.data_type as PrDataType, {
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      prNumber: row.pr_number,
      dataType: row.data_type,
      schemaVersion: row.schema_version,
      fetchedAt: row.fetched_at,
      source: row.source,
      githubAvailable: row.github_available,
      data: row.data,
    })
  }
  return snapshots
}

export async function savePrSnapshotsBatch(
  owner: string,
  repo: string,
  prNumber: number,
  snapshots: Array<{ dataType: PrDataType; data: unknown }>,
): Promise<number[]> {
  if (snapshots.length === 0) return []

  const values: unknown[] = []
  const placeholders: string[] = []

  snapshots.forEach((snapshot, idx) => {
    const offset = idx * 7
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`,
    )
    values.push(
      owner,
      repo,
      prNumber,
      snapshot.dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(snapshot.data),
      'github',
    )
  })

  const result = await pool.query(
    `INSERT INTO github_pr_snapshots 
       (owner, repo, pr_number, data_type, schema_version, data, source)
     VALUES ${placeholders.join(', ')}
     RETURNING id`,
    values,
  )

  return result.rows.map((row: { id: number }) => row.id)
}

export async function saveCommitSnapshot(
  owner: string,
  repo: string,
  sha: string,
  dataType: CommitDataType,
  data: unknown,
  options?: {
    source?: 'github' | 'cached'
    githubAvailable?: boolean
  },
): Promise<number> {
  const result = await pool.query(
    `INSERT INTO github_commit_snapshots 
       (owner, repo, sha, data_type, schema_version, data, source, github_available)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      owner,
      repo,
      sha,
      dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(data),
      options?.source ?? 'github',
      options?.githubAvailable ?? true,
    ],
  )
  return result.rows[0].id
}

export async function getLatestCommitSnapshot(
  owner: string,
  repo: string,
  sha: string,
  dataType: CommitDataType,
  options?: {
    requireCurrentSchema?: boolean
  },
): Promise<CommitSnapshot | null> {
  const requireCurrent = options?.requireCurrentSchema ?? true

  const result = await pool.query(
    `SELECT id, owner, repo, sha, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_commit_snapshots
     WHERE owner = $1 AND repo = $2 AND sha = $3 AND data_type = $4
       ${requireCurrent ? `AND schema_version = ${CURRENT_SCHEMA_VERSION}` : ''}
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [owner, repo, sha, dataType],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    sha: row.sha,
    dataType: row.data_type,
    schemaVersion: row.schema_version,
    fetchedAt: row.fetched_at,
    source: row.source,
    githubAvailable: row.github_available,
    data: row.data,
  }
}

async function _getAllLatestCommitSnapshots(
  owner: string,
  repo: string,
  sha: string,
): Promise<Map<CommitDataType, CommitSnapshot>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (data_type) 
            id, owner, repo, sha, data_type, schema_version, 
            fetched_at, source, github_available, data
     FROM github_commit_snapshots
     WHERE owner = $1 AND repo = $2 AND sha = $3
       AND schema_version = $4
     ORDER BY data_type, fetched_at DESC`,
    [owner, repo, sha, CURRENT_SCHEMA_VERSION],
  )

  const snapshots = new Map<CommitDataType, CommitSnapshot>()
  for (const row of result.rows) {
    snapshots.set(row.data_type as CommitDataType, {
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      sha: row.sha,
      dataType: row.data_type,
      schemaVersion: row.schema_version,
      fetchedAt: row.fetched_at,
      source: row.source,
      githubAvailable: row.github_available,
      data: row.data,
    })
  }
  return snapshots
}

async function _saveCommitSnapshotsBatch(
  snapshots: Array<{
    owner: string
    repo: string
    sha: string
    dataType: CommitDataType
    data: unknown
  }>,
): Promise<number[]> {
  if (snapshots.length === 0) return []

  const values: unknown[] = []
  const placeholders: string[] = []

  snapshots.forEach((snapshot, idx) => {
    const offset = idx * 7
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`,
    )
    values.push(
      snapshot.owner,
      snapshot.repo,
      snapshot.sha,
      snapshot.dataType,
      CURRENT_SCHEMA_VERSION,
      JSON.stringify(snapshot.data),
      'github',
    )
  })

  const result = await pool.query(
    `INSERT INTO github_commit_snapshots 
       (owner, repo, sha, data_type, schema_version, data, source)
     VALUES ${placeholders.join(', ')}
     RETURNING id`,
    values,
  )

  return result.rows.map((row: { id: number }) => row.id)
}

export async function markPrDataUnavailable(
  owner: string,
  repo: string,
  prNumber: number,
  dataType: PrDataType,
): Promise<void> {
  const lastGood = await getLatestPrSnapshot(owner, repo, prNumber, dataType, {
    requireCurrentSchema: false,
  })

  if (lastGood) {
    await savePrSnapshot(owner, repo, prNumber, dataType, lastGood.data, {
      source: 'cached',
      githubAvailable: false,
    })
  }
}

async function _markCommitDataUnavailable(
  owner: string,
  repo: string,
  sha: string,
  dataType: CommitDataType,
): Promise<void> {
  const lastGood = await getLatestCommitSnapshot(owner, repo, sha, dataType, {
    requireCurrentSchema: false,
  })

  if (lastGood) {
    await saveCommitSnapshot(owner, repo, sha, dataType, lastGood.data, {
      source: 'cached',
      githubAvailable: false,
    })
  }
}

export async function saveVerificationRun(
  deploymentId: number,
  result: {
    status: string
    result: unknown
  },
  snapshotIds: {
    prSnapshotIds: number[]
    commitSnapshotIds: number[]
  },
): Promise<number> {
  const queryResult = await pool.query(
    `INSERT INTO verification_runs 
       (deployment_id, schema_version, pr_snapshot_ids, commit_snapshot_ids, result, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      deploymentId,
      CURRENT_SCHEMA_VERSION,
      snapshotIds.prSnapshotIds,
      snapshotIds.commitSnapshotIds,
      JSON.stringify(result.result),
      result.status,
    ],
  )
  return queryResult.rows[0].id
}

export async function getLatestVerificationRun(deploymentId: number): Promise<{
  id: number
  schemaVersion: number
  runAt: Date
  prSnapshotIds: number[]
  commitSnapshotIds: number[]
  result: unknown
  status: string
} | null> {
  const result = await pool.query(
    `SELECT id, schema_version, run_at, pr_snapshot_ids, commit_snapshot_ids, 
            result, status
     FROM verification_runs
     WHERE deployment_id = $1
     ORDER BY run_at DESC
     LIMIT 1`,
    [deploymentId],
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    runAt: row.run_at,
    prSnapshotIds: row.pr_snapshot_ids,
    commitSnapshotIds: row.commit_snapshot_ids,
    result: row.result,
    status: row.status,
  }
}

async function _getVerificationRunHistory(
  deploymentId: number,
  options?: { limit?: number },
): Promise<
  Array<{
    id: number
    schemaVersion: number
    runAt: Date
    status: string
  }>
> {
  const limit = options?.limit ?? 10

  const result = await pool.query(
    `SELECT id, schema_version, run_at, status
     FROM verification_runs
     WHERE deployment_id = $1
     ORDER BY run_at DESC
     LIMIT $2`,
    [deploymentId, limit],
  )

  return result.rows.map((row: { id: number; schema_version: number; run_at: Date; status: string }) => ({
    id: row.id,
    schemaVersion: row.schema_version,
    runAt: row.run_at,
    status: row.status,
  }))
}

async function _cleanupOldSnapshots(options?: {
  keepCount?: number
  olderThanDays?: number
}): Promise<{ prSnapshotsDeleted: number; commitSnapshotsDeleted: number }> {
  const keepCount = options?.keepCount ?? 5
  const olderThanDays = options?.olderThanDays ?? 90

  const prResult = await pool.query(
    `DELETE FROM github_pr_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY owner, repo, pr_number, data_type 
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_pr_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const commitResult = await pool.query(
    `DELETE FROM github_commit_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY owner, repo, sha, data_type 
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_commit_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  return {
    prSnapshotsDeleted: prResult.rowCount ?? 0,
    commitSnapshotsDeleted: commitResult.rowCount ?? 0,
  }
}

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
