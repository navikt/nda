import { AUDIT_START_YEAR_FILTER } from '~/db/audit-start-year'
import { pool } from '~/db/connection.server'
import { APPROVED_STATUSES_SQL, LEGACY_STATUSES_SQL } from '~/lib/four-eyes-status'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'

interface VerificationDiffDeployment {
  id: number
  commit_sha: string
  four_eyes_status: string
  github_pr_number: number | null
  environment_name: string
  created_at: Date
  detected_github_owner: string
  detected_github_repo_name: string
  default_branch: string
  audit_start_year: number | null
}

/**
 * Get deployments eligible for verification diff analysis.
 * Includes all valid deployments regardless of whether they have compare snapshots.
 */
export async function getDeploymentsForDiffComputation(monitoredAppId: number): Promise<VerificationDiffDeployment[]> {
  const result = await pool.query(
    `SELECT 
        d.id,
        d.commit_sha,
        d.four_eyes_status,
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
        AND ${VALID_COMMIT_SHA_SQL}
        AND ${AUDIT_START_YEAR_FILTER}
      ORDER BY created_at DESC`,
    [monitoredAppId],
  )
  return result.rows
}

/**
 * Get the previous deployment for a given deployment in the same app/env.
 *
 * Mirrors the filters in getPreviousDeployment (fetch-data.server.ts) so the
 * cache-path used by compute-diffs and reverifyDeployment produces the same
 * `previousDeployment` value as a fresh fetch:
 *   - audit_start_year (when set on the monitored app)
 *   - excludes legacy / legacy_pending deployments
 *   - excludes refs/* sha values
 */
export async function getPreviousDeploymentForDiff(
  deploymentId: number,
  environmentName: string,
): Promise<{ id: number; commit_sha: string; created_at: Date } | null> {
  const result = await pool.query(
    `SELECT d.id, d.commit_sha, d.created_at
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.monitored_app_id = (SELECT monitored_app_id FROM deployments WHERE id = $1)
       AND d.environment_name = $2
       AND d.created_at < (SELECT created_at FROM deployments WHERE id = $1)
       AND d.commit_sha IS NOT NULL
       AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
       AND d.commit_sha !~ '^refs/'
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY d.created_at DESC
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

interface MissingApproverDeployment {
  id: number
  commit_sha: string | null
  four_eyes_status: string
  environment_name: string
  created_at: Date
  deployer_username: string | null
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  monitored_app_id: number
  default_branch: string | null
}

/**
 * Shared SQL conditions for detecting deployments missing approver data.
 * A deployment is missing approver data when it has neither:
 *   - PR reviewers with state='APPROVED' in github_pr_data, nor
 *   - An active (non-deleted) manual_approval comment
 *
 * Excludes no_changes, baseline, and implicitly_approved — the first two
 * don't require a separate approver, and implicitly_approved uses the PR merger.
 *
 * Requires the deployments table to be aliased as `d`.
 */
const MISSING_APPROVER_STATUS_EXCLUSIONS = `d.four_eyes_status NOT IN ('no_changes', 'baseline', 'implicitly_approved')`

const MISSING_APPROVER_CONDITIONS = `
  ${MISSING_APPROVER_STATUS_EXCLUSIONS}
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(d.github_pr_data->'reviewers') AS r
    WHERE r->>'state' = 'APPROVED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM deployment_comments dc
    WHERE dc.deployment_id = d.id
      AND dc.comment_type = 'manual_approval'
      AND dc.deleted_at IS NULL
  )`

/**
 * Find deployment IDs from a given set that are missing approver data.
 * Used by checkAuditReadiness to check a pre-filtered set of approved deployments.
 */
export async function findDeploymentIdsMissingApprover(deploymentIds: number[]): Promise<Set<number>> {
  if (deploymentIds.length === 0) return new Set()
  const result = await pool.query<{ id: number }>(
    `SELECT d.id FROM deployments d
     WHERE d.id = ANY($1) AND ${MISSING_APPROVER_CONDITIONS}`,
    [deploymentIds],
  )
  return new Set(result.rows.map((r) => r.id))
}

/**
 * Find approved deployments that have no approver data for a monitored app.
 * Used by the verification diff page to show a warning.
 */
export async function getApprovedDeploymentsMissingApprover(
  monitoredAppId: number,
): Promise<MissingApproverDeployment[]> {
  const result = await pool.query<MissingApproverDeployment>(
    `SELECT d.id, d.commit_sha, d.four_eyes_status, d.environment_name,
            d.created_at, d.deployer_username,
            d.detected_github_owner, d.detected_github_repo_name,
            d.monitored_app_id, ma.default_branch
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     WHERE d.monitored_app_id = $1
       AND COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})
       AND ${MISSING_APPROVER_CONDITIONS}
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY d.created_at DESC`,
    [monitoredAppId],
  )
  return result.rows
}

interface GlobalMissingApproverDeployment extends MissingApproverDeployment {
  team_slug: string
  app_name: string
}

/**
 * Find approved deployments missing approver data across ALL monitored applications.
 * Used by the global admin verification-diffs page.
 */
export async function getAllApprovedDeploymentsMissingApprover(): Promise<GlobalMissingApproverDeployment[]> {
  const result = await pool.query<GlobalMissingApproverDeployment>(
    `SELECT d.id, d.commit_sha, d.four_eyes_status, d.environment_name,
            d.created_at, d.deployer_username,
            d.detected_github_owner, d.detected_github_repo_name,
            d.monitored_app_id, ma.default_branch,
            d.team_slug, d.app_name
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})
       AND ${MISSING_APPROVER_CONDITIONS}
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY d.team_slug, d.app_name, d.created_at DESC`,
  )
  return result.rows
}

interface MissingApproverSummary {
  team_slug: string
  environment_name: string
  app_name: string
  count: number
}

/**
 * Get aggregated counts of missing-approver deployments grouped by app.
 * Lightweight alternative to getAllApprovedDeploymentsMissingApprover for loader use.
 */
export async function getMissingApproverSummary(): Promise<{
  total: number
  byApp: MissingApproverSummary[]
}> {
  const result = await pool.query<MissingApproverSummary>(
    `SELECT d.team_slug, d.environment_name, d.app_name, COUNT(*)::int AS count
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     WHERE COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})
       AND ${MISSING_APPROVER_CONDITIONS}
       AND ${AUDIT_START_YEAR_FILTER}
     GROUP BY d.team_slug, d.environment_name, d.app_name
     ORDER BY d.team_slug, d.app_name`,
  )
  const total = result.rows.reduce((sum, r) => sum + r.count, 0)
  return { total, byApp: result.rows }
}
