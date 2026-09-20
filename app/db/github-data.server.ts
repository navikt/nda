import type { PoolClient } from 'pg'
import { pool } from '~/db/connection.server'
import type { ApiVersionMetadata } from '~/lib/github/pr-snapshot'
import {
  type CommitDataType,
  type CommitSnapshot,
  CURRENT_SCHEMA_VERSION,
  type PrDataType,
  type PrRawDataType,
  type PrRawSnapshot,
  type PrSnapshot,
} from '~/lib/verification/types'

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
     ORDER BY data_type, fetched_at DESC`,
    [owner, repo, prNumber],
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

export async function savePrRawSnapshotsBatch(
  owner: string,
  repo: string,
  prNumber: number,
  githubRepoId: number,
  apiVersion: ApiVersionMetadata,
  snapshots: Array<{ dataType: PrRawDataType; data: unknown }>,
): Promise<number[]> {
  if (snapshots.length === 0) return []

  const values: unknown[] = []
  const placeholders: string[] = []

  snapshots.forEach((snapshot, idx) => {
    const offset = idx * 9
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`,
    )
    values.push(
      githubRepoId,
      owner,
      repo,
      prNumber,
      snapshot.dataType,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(snapshot.data),
    )
  })

  const result = await pool.query(
    `INSERT INTO github_pr_raw_snapshots
       (github_repo_id, owner, repo, pr_number, data_type, api_version, api_deprecated_at, api_sunset_at, data)
     VALUES ${placeholders.join(', ')}
     RETURNING id`,
    values,
  )

  return result.rows.map((row: { id: number }) => row.id)
}

export async function getAllLatestPrRawSnapshots(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Map<PrRawDataType, PrRawSnapshot>> {
  const result = await pool.query(
    `SELECT DISTINCT ON (data_type)
            id, owner, repo, github_repo_id, pr_number, data_type,
            api_version, api_deprecated_at, api_sunset_at, fetched_at, data
     FROM github_pr_raw_snapshots
     WHERE owner = $1 AND repo = $2 AND pr_number = $3
       AND github_repo_id = (
         SELECT github_repo_id
         FROM github_pr_raw_snapshots
         WHERE owner = $1 AND repo = $2 AND pr_number = $3
         ORDER BY fetched_at DESC
         LIMIT 1
       )
     ORDER BY data_type, fetched_at DESC`,
    [owner, repo, prNumber],
  )

  const snapshots = new Map<PrRawDataType, PrRawSnapshot>()
  for (const row of result.rows) {
    snapshots.set(row.data_type as PrRawDataType, {
      id: row.id,
      owner: row.owner,
      repo: row.repo,
      githubRepoId: Number(row.github_repo_id),
      prNumber: row.pr_number,
      dataType: row.data_type,
      apiVersion: row.api_version,
      apiDeprecatedAt: row.api_deprecated_at ? new Date(row.api_deprecated_at).toISOString() : null,
      apiSunsetAt: row.api_sunset_at ? new Date(row.api_sunset_at).toISOString() : null,
      fetchedAt: row.fetched_at,
      data: row.data,
    })
  }
  return snapshots
}

const DEFAULT_CLEANUP_BATCH_SIZE = 5000
const DEFAULT_MAX_ROWS_PER_TABLE = 50000
const DEFAULT_CLEANUP_MAX_DURATION_MS = 20000

interface SnapshotCleanupOptions {
  keepCount?: number
  olderThanDays?: number
  batchSize?: number
  maxRowsPerTable?: number
  maxDurationMs?: number
}

interface SnapshotTableSpec {
  tableName: string
  partitionColumns: string
  resultKey: string
}

const SNAPSHOT_TABLE_SPECS: SnapshotTableSpec[] = [
  {
    tableName: 'github_pr_raw_snapshots',
    partitionColumns: 'github_repo_id, pr_number, data_type',
    resultKey: 'prRawSnapshotsDeleted',
  },
  {
    tableName: 'github_compare_raw_snapshots',
    partitionColumns: 'github_repo_id, base_sha, head_sha',
    resultKey: 'compareRawSnapshotsDeleted',
  },
  {
    tableName: 'github_checks_raw_snapshots',
    partitionColumns: 'github_repo_id, sha, check_suite_id',
    resultKey: 'checksRawSnapshotsDeleted',
  },
  {
    tableName: 'github_workflow_runs_raw_snapshots',
    partitionColumns: 'github_repo_id, run_id',
    resultKey: 'workflowRunsRawSnapshotsDeleted',
  },
  {
    tableName: 'github_commit_raw_snapshots',
    partitionColumns: 'github_repo_id, sha',
    resultKey: 'commitRawSnapshotsDeleted',
  },
  {
    tableName: 'github_commit_associated_prs_raw_snapshots',
    partitionColumns: 'github_repo_id, sha',
    resultKey: 'commitAssociatedPrsRawSnapshotsDeleted',
  },
  {
    tableName: 'github_pr_window_raw_snapshots',
    partitionColumns: 'github_repo_id, pr_number',
    resultKey: 'prWindowRawSnapshotsDeleted',
  },
  {
    tableName: 'github_check_annotations_raw_snapshots',
    partitionColumns: 'github_repo_id, check_run_id',
    resultKey: 'checkAnnotationsRawSnapshotsDeleted',
  },
]

async function connectWithDeadline(deadline: number) {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) return null
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      resolve(null)
    }, remainingMs)
  })
  const connectPromise = pool.connect()
  connectPromise.catch(() => {})
  let client: PoolClient | null
  try {
    client = await Promise.race([connectPromise, timeoutPromise])
  } catch {
    clearTimeout(timer)
    return null
  }
  if (timedOut || client === null) {
    connectPromise
      .then((lateClient) => {
        lateClient.release()
      })
      .catch(() => {})
    return null
  }
  clearTimeout(timer)
  return client
}

const TRANSIENT_DB_ERROR_PATTERN = /statement timeout|terminating connection|connection terminated|econnreset/i

function isTransientDbError(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_DB_ERROR_PATTERN.test(error.message)
}

async function deleteOldSnapshotsBatched(
  tableName: string,
  partitionColumns: string,
  keepCount: number,
  olderThanDays: number,
  batchSize: number,
  maxRowsPerTable: number,
  deadline: number,
): Promise<{ deleted: number; truncated: boolean }> {
  let deleted = 0
  let truncated = false

  const client = await connectWithDeadline(deadline)
  if (!client) {
    return { deleted: 0, truncated: true }
  }
  try {
    const remainingMsForMaterialize = deadline - Date.now()
    if (remainingMsForMaterialize <= 0) {
      return { deleted: 0, truncated: true }
    }

    let materializedCount = 0
    try {
      await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(remainingMsForMaterialize))}`)
      const materialized = await client.query(
        `CREATE TEMP TABLE snapshot_cleanup_candidates AS
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY ${partitionColumns}
             ORDER BY fetched_at DESC, id DESC
           ) as rn
           FROM ${tableName}
           WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
         ) ranked
         WHERE rn > $1
         LIMIT $2`,
        [keepCount, maxRowsPerTable + 1],
      )
      materializedCount = materialized.rowCount ?? 0
      if (materializedCount > maxRowsPerTable) {
        truncated = true
        materializedCount = maxRowsPerTable
      }
    } catch (error) {
      if (isTransientDbError(error)) {
        return { deleted: 0, truncated: true }
      }
      throw error
    } finally {
      await client.query('SET statement_timeout = 0').catch(() => {})
    }

    let consumed = 0
    while (consumed < materializedCount) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        truncated = true
        break
      }

      const remainingBudget = Math.min(batchSize, materializedCount - consumed)
      let batchConsumed = 0
      let rowsDeleted = 0
      try {
        await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(remainingMs))}`)
        const batchResult = await client.query<{ id: number }>(
          `DELETE FROM snapshot_cleanup_candidates
           WHERE id IN (SELECT id FROM snapshot_cleanup_candidates LIMIT $1)
           RETURNING id`,
          [remainingBudget],
        )
        const candidateIds = batchResult.rows.map((row) => row.id)
        batchConsumed = candidateIds.length
        if (candidateIds.length > 0) {
          const remainingMsForDelete = deadline - Date.now()
          if (remainingMsForDelete <= 0) {
            truncated = true
            break
          }
          await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(remainingMsForDelete))}`)
          const deleteResult = await client.query(`DELETE FROM ${tableName} WHERE id = ANY($1)`, [candidateIds])
          rowsDeleted = deleteResult.rowCount ?? 0
        }
      } catch (error) {
        if (isTransientDbError(error)) {
          truncated = true
          break
        }
        throw error
      } finally {
        await client.query('SET statement_timeout = 0').catch(() => {})
      }

      deleted += rowsDeleted
      consumed += batchConsumed

      if (batchConsumed < remainingBudget) {
        break
      }
    }
  } finally {
    await client.query('DROP TABLE IF EXISTS snapshot_cleanup_candidates').catch(() => {})
    client.release()
  }

  return { deleted, truncated }
}

export type SnapshotCleanupResult = { counts: Record<string, number>; truncated: boolean }

let cleanupStartTableIndex = 0
let cleanupInFlight: { key: string; promise: Promise<SnapshotCleanupResult> } | null = null
let cleanupQueue: Promise<unknown> = Promise.resolve()

function normalizeCleanupOptions(options?: SnapshotCleanupOptions): string {
  return JSON.stringify({
    keepCount: options?.keepCount ?? 5,
    olderThanDays: options?.olderThanDays ?? 90,
    batchSize: options?.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE,
    maxRowsPerTable: options?.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE,
    maxDurationMs: options?.maxDurationMs ?? DEFAULT_CLEANUP_MAX_DURATION_MS,
  })
}

export async function cleanupOldSnapshots(options?: SnapshotCleanupOptions): Promise<SnapshotCleanupResult> {
  const key = normalizeCleanupOptions(options)
  if (cleanupInFlight?.key === key) {
    return cleanupInFlight.promise
  }

  const previousQueue = cleanupQueue
  const run = previousQueue.then(() => cleanupOldSnapshotsInternal(options))
  cleanupQueue = run.catch(() => {})
  cleanupInFlight = { key, promise: run }
  run.finally(() => {
    if (cleanupInFlight?.promise === run) {
      cleanupInFlight = null
    }
  })
  return run
}

async function cleanupOldSnapshotsInternal(options?: SnapshotCleanupOptions): Promise<SnapshotCleanupResult> {
  const keepCount = options?.keepCount ?? 5
  const olderThanDays = options?.olderThanDays ?? 90
  const batchSize = options?.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE
  const maxRowsPerTable = options?.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE
  const maxDurationMs = options?.maxDurationMs ?? DEFAULT_CLEANUP_MAX_DURATION_MS
  const deadline = Date.now() + maxDurationMs

  const counts: Record<string, number> = {}
  let truncated = false

  const tableCount = SNAPSHOT_TABLE_SPECS.length
  const startIndex = cleanupStartTableIndex % tableCount
  cleanupStartTableIndex = (startIndex + 1) % tableCount

  for (let offset = 0; offset < tableCount; offset++) {
    const spec = SNAPSHOT_TABLE_SPECS[(startIndex + offset) % tableCount]
    if (Date.now() >= deadline) {
      counts[spec.resultKey] = 0
      truncated = true
      continue
    }
    const deletedForTable = await deleteOldSnapshotsBatched(
      spec.tableName,
      spec.partitionColumns,
      keepCount,
      olderThanDays,
      batchSize,
      maxRowsPerTable,
      deadline,
    )
    counts[spec.resultKey] = deletedForTable.deleted
    if (deletedForTable.truncated) truncated = true
  }

  return { counts, truncated }
}

export {
  getLatestCheckAnnotationsRawSnapshot,
  saveCheckAnnotationsRawSnapshot,
} from './github-data/check-annotations-raw-snapshots.server'
export {
  getDerivedChecksDataFromRawSnapshot,
  getLatestDefinitiveChecksRawSnapshot,
  saveChecksRawSnapshot,
} from './github-data/checks-raw-snapshots.server'
export {
  getLatestCommitAssociatedPrsRawSnapshot,
  saveCommitAssociatedPrsRawSnapshot,
} from './github-data/commit-associated-prs-raw-snapshots.server'
export { getLatestCommitRawSnapshot, saveCommitRawSnapshot } from './github-data/commit-raw-snapshots.server'
export {
  type GitHubDataStats,
  getDerivedCompareDataFromRawSnapshot,
  getGitHubDataStatsForApp,
  getGitHubDataStatsForRepository,
  getLatestCompareRawSnapshot,
  getLatestCompareSnapshot,
  saveCompareRawSnapshot,
  saveCompareSnapshot,
} from './github-data/compare-stats.server'
export { getLatestPrWindowRawSnapshot, savePrWindowRawSnapshot } from './github-data/pr-window-raw-snapshots.server'
export { getLatestVerificationRun, saveVerificationRun } from './github-data/verification-runs.server'
export {
  getLatestWorkflowRunRawSnapshot,
  saveWorkflowRunRawSnapshot,
} from './github-data/workflow-run-raw-snapshots.server'
