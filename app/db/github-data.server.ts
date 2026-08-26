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

export async function cleanupOldSnapshots(options?: { keepCount?: number; olderThanDays?: number }): Promise<{
  prSnapshotsDeleted: number
  commitSnapshotsDeleted: number
  prRawSnapshotsDeleted: number
  compareRawSnapshotsDeleted: number
  checksRawSnapshotsDeleted: number
  workflowRunsRawSnapshotsDeleted: number
  commitRawSnapshotsDeleted: number
  commitOnBranchRawSnapshotsDeleted: number
  commitAssociatedPrsRawSnapshotsDeleted: number
  prWindowRawSnapshotsDeleted: number
  checkAnnotationsRawSnapshotsDeleted: number
}> {
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

  const prRawResult = await pool.query(
    `DELETE FROM github_pr_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, pr_number, data_type 
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_pr_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const compareRawResult = await pool.query(
    `DELETE FROM github_compare_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, base_sha, head_sha
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_compare_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const checksRawResult = await pool.query(
    `DELETE FROM github_checks_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, sha, check_suite_id
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_checks_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const workflowRunsRawResult = await pool.query(
    `DELETE FROM github_workflow_runs_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, run_id
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_workflow_runs_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const commitRawResult = await pool.query(
    `DELETE FROM github_commit_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, sha
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_commit_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const commitOnBranchRawResult = await pool.query(
    `DELETE FROM github_commit_on_branch_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, commit_sha, branch
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_commit_on_branch_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const commitAssociatedPrsRawResult = await pool.query(
    `DELETE FROM github_commit_associated_prs_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, sha
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_commit_associated_prs_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const prWindowRawResult = await pool.query(
    `DELETE FROM github_pr_window_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, pr_number
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_pr_window_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  const checkAnnotationsRawResult = await pool.query(
    `DELETE FROM github_check_annotations_raw_snapshots
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY github_repo_id, check_run_id
           ORDER BY fetched_at DESC
         ) as rn
         FROM github_check_annotations_raw_snapshots
         WHERE fetched_at < NOW() - INTERVAL '${olderThanDays} days'
       ) ranked
       WHERE rn > $1
     )`,
    [keepCount],
  )

  return {
    prSnapshotsDeleted: prResult.rowCount ?? 0,
    commitSnapshotsDeleted: commitResult.rowCount ?? 0,
    prRawSnapshotsDeleted: prRawResult.rowCount ?? 0,
    compareRawSnapshotsDeleted: compareRawResult.rowCount ?? 0,
    checksRawSnapshotsDeleted: checksRawResult.rowCount ?? 0,
    workflowRunsRawSnapshotsDeleted: workflowRunsRawResult.rowCount ?? 0,
    commitRawSnapshotsDeleted: commitRawResult.rowCount ?? 0,
    commitOnBranchRawSnapshotsDeleted: commitOnBranchRawResult.rowCount ?? 0,
    commitAssociatedPrsRawSnapshotsDeleted: commitAssociatedPrsRawResult.rowCount ?? 0,
    prWindowRawSnapshotsDeleted: prWindowRawResult.rowCount ?? 0,
    checkAnnotationsRawSnapshotsDeleted: checkAnnotationsRawResult.rowCount ?? 0,
  }
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
export {
  getLatestCommitOnBranchRawSnapshot,
  saveCommitOnBranchRawSnapshot,
} from './github-data/commit-on-branch-raw-snapshots.server'
export { getLatestCommitRawSnapshot, saveCommitRawSnapshot } from './github-data/commit-raw-snapshots.server'
export {
  getDerivedCompareDataFromRawSnapshot,
  getGitHubDataStatsForApp,
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
