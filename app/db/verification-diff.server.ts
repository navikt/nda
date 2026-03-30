import { pool } from '~/db/connection.server'

interface VerificationDiffDeployment {
  id: number
  commit_sha: string
  four_eyes_status: string
  has_four_eyes: boolean
  github_pr_number: number | null
  environment_name: string
  created_at: Date
  detected_github_owner: string
  detected_github_repo_name: string
  default_branch: string
  audit_start_year: number | null
}

/**
 * Get deployments with compare snapshots for verification diff analysis
 */
export async function getDeploymentsWithCompareData(
  monitoredAppId: number,
  limit = 500,
): Promise<VerificationDiffDeployment[]> {
  const result = await pool.query(
    `WITH valid_deployments AS (
      SELECT 
        d.id,
        d.commit_sha,
        d.four_eyes_status,
        d.has_four_eyes,
        d.github_pr_number,
        d.environment_name,
        d.created_at,
        d.detected_github_owner,
        d.detected_github_repo_name,
        ma.default_branch,
        ma.audit_start_year
      FROM deployments d
      JOIN monitored_applications ma ON d.monitored_app_id = ma.id
      WHERE d.monitored_app_id = $1
        AND d.commit_sha IS NOT NULL
        AND d.detected_github_owner IS NOT NULL
        AND d.detected_github_repo_name IS NOT NULL
        AND d.commit_sha !~ '^refs/'
        AND LENGTH(d.commit_sha) >= 7
        AND (ma.audit_start_year IS NULL OR d.created_at >= (ma.audit_start_year || '-01-01')::date)
    ),
    deployments_with_data AS (
      SELECT DISTINCT vd.*
      FROM valid_deployments vd
      WHERE EXISTS (
        SELECT 1 FROM github_compare_snapshots gcs
        WHERE gcs.head_sha = vd.commit_sha
      )
    )
    SELECT * FROM deployments_with_data
    ORDER BY created_at DESC
    LIMIT $2`,
    [monitoredAppId, limit],
  )
  return result.rows
}

/**
 * Get the previous deployment for a given deployment in the same app/env
 */
export async function getPreviousDeploymentForDiff(
  deploymentId: number,
  environmentName: string,
): Promise<{ id: number; commit_sha: string; created_at: Date } | null> {
  const result = await pool.query(
    `SELECT id, commit_sha, created_at
     FROM deployments 
     WHERE monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
       AND environment_name = $2
       AND created_at < (SELECT created_at FROM deployments WHERE id = $1)
     ORDER BY created_at DESC
     LIMIT 1`,
    [deploymentId, environmentName],
  )
  return result.rows[0] || null
}

/**
 * Get the latest compare snapshot for a commit SHA
 */
export async function getCompareSnapshotForCommit(
  commitSha: string,
): Promise<{ data: unknown; base_sha: string } | null> {
  const result = await pool.query(
    `SELECT data, base_sha FROM github_compare_snapshots 
     WHERE head_sha = $1 
     ORDER BY fetched_at DESC LIMIT 1`,
    [commitSha],
  )
  return result.rows[0] || null
}

/**
 * Get PR snapshots for a given PR number, latest of each data_type
 */
export async function getPrSnapshotsForDiff(prNumber: number): Promise<Map<string, unknown>> {
  const result = await pool.query(
    `SELECT data_type, data FROM github_pr_snapshots 
     WHERE pr_number = $1 
     ORDER BY fetched_at DESC`,
    [prNumber],
  )

  const snapshotMap = new Map<string, unknown>()
  for (const snap of result.rows) {
    if (!snapshotMap.has(snap.data_type)) {
      snapshotMap.set(snap.data_type, snap.data)
    }
  }
  return snapshotMap
}
