import { pool } from '~/db/connection.server'
import { CURRENT_SCHEMA_VERSION, type StoredVerificationResult } from '~/lib/verification/types'

export async function getLatestVerificationRanges(
  deploymentIds: number[],
): Promise<Record<number, StoredVerificationResult['comparisonRange']>> {
  if (deploymentIds.length === 0) return {}
  const { rows } = await pool.query<{ deployment_id: number; base_sha: string | null; head_sha: string | null }>(
    `SELECT DISTINCT ON (deployment_id) deployment_id,
            result->'comparisonRange'->>'baseSha' AS base_sha,
            result->'comparisonRange'->>'headSha' AS head_sha
     FROM verification_runs
     WHERE deployment_id = ANY($1)
     ORDER BY deployment_id, run_at DESC, id DESC`,
    [deploymentIds],
  )
  return Object.fromEntries(
    rows.map((row) => [
      row.deployment_id,
      row.base_sha?.length === 40 &&
      row.head_sha?.length === 40 &&
      /^[0-9a-f]{40}$/i.test(row.base_sha) &&
      /^[0-9a-f]{40}$/i.test(row.head_sha)
        ? { baseSha: row.base_sha, headSha: row.head_sha }
        : null,
    ]),
  )
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
