import { LATEST_ACTIVE_REPOSITORY_LINK_SQL } from '~/db/application-repositories.server'
import { AUDIT_START_YEAR_FILTER } from '~/db/audit-start-year'
import { pool } from '~/db/connection.server'
import { effectiveAuditStartYearSql, effectiveDefaultBranchSql } from '~/db/repository-settings-sql'
import { APPROVED_STATUSES_SQL, NON_DIFFABLE_STATUSES_SQL, UNAUTHORIZED_STATUSES_SQL } from '~/lib/four-eyes-status'
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
  default_branch: string | null
  audit_start_year: number | null
}

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
        ${effectiveDefaultBranchSql('ma')} AS default_branch,
        ${effectiveAuditStartYearSql('ma')} AS audit_start_year
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

export interface RepositoryDeploymentDiff {
  deployment_id: number
  old_status: string | null
  new_status: string
  error_reason: string | null
  commit_sha: string
  environment_name: string
  created_at: Date
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  monitored_app_id: number
  team_slug: string
  app_name: string
}

export async function getVerificationDiffsForRepository(
  repositoryId: number,
  monitoredAppIds: number[],
): Promise<RepositoryDeploymentDiff[]> {
  if (monitoredAppIds.length === 0) return []
  const result = await pool.query<RepositoryDeploymentDiff>(
    `SELECT vd.deployment_id, vd.old_status, vd.new_status, vd.error_reason,
            d.commit_sha, d.environment_name, d.created_at,
            d.detected_github_owner, d.detected_github_repo_name,
            d.monitored_app_id, d.team_slug, d.app_name
     FROM verification_diffs vd
     JOIN deployments d ON vd.deployment_id = d.id
     WHERE vd.repository_id = $1
       AND d.monitored_app_id = ANY($2)
     ORDER BY d.created_at DESC`,
    [repositoryId, monitoredAppIds],
  )
  return result.rows
}

export async function getPreviousDeploymentForDiff(
  deploymentId: number,
  githubRepoId: string,
): Promise<{
  id: number
  commit_sha: string
  created_at: Date
  monitored_app_id: number
  four_eyes_status: string
  comparison_base_sha: string | null
} | null> {
  const result = await pool.query(
    `WITH active_repo_per_app AS MATERIALIZED (
       ${LATEST_ACTIVE_REPOSITORY_LINK_SQL}
     )
     SELECT d.id, d.commit_sha, d.created_at, d.monitored_app_id, d.four_eyes_status,
            comparison_base.commit_sha AS comparison_base_sha
     FROM deployments d
     JOIN application_repositories ar
       ON ar.monitored_app_id = d.monitored_app_id
       AND ar.github_owner = d.detected_github_owner
       AND ar.github_repo_name = d.detected_github_repo_name
       AND ar.status IN ('active', 'historical')
     JOIN active_repo_per_app active_ar
       ON active_ar.monitored_app_id = d.monitored_app_id
       AND active_ar.github_repo_id = ar.github_repo_id
     LEFT JOIN LATERAL (
       SELECT prior.commit_sha
       FROM deployments prior
       JOIN application_repositories prior_ar
         ON prior_ar.monitored_app_id = prior.monitored_app_id
         AND prior_ar.github_owner = prior.detected_github_owner
         AND prior_ar.github_repo_name = prior.detected_github_repo_name
         AND prior_ar.github_repo_id = $2
         AND prior_ar.status IN ('active', 'historical')
       JOIN active_repo_per_app prior_active_ar
         ON prior_active_ar.monitored_app_id = prior.monitored_app_id
         AND prior_active_ar.github_repo_id = prior_ar.github_repo_id
       WHERE (prior.created_at, prior.id) < (d.created_at, d.id)
         AND prior.commit_sha IS NOT NULL
         AND prior.commit_sha != d.commit_sha
         AND prior.four_eyes_status NOT IN (${NON_DIFFABLE_STATUSES_SQL})
         AND prior.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
         AND prior.commit_sha !~ '^refs/'
       ORDER BY prior.created_at DESC, prior.id DESC
       LIMIT 1
     ) comparison_base ON true
     WHERE ar.github_repo_id = $2
       AND (d.created_at, d.id) < (SELECT created_at, id FROM deployments WHERE id = $1)
       AND d.commit_sha IS NOT NULL
       AND d.four_eyes_status NOT IN (${NON_DIFFABLE_STATUSES_SQL})
       AND d.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
       AND d.commit_sha !~ '^refs/'
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT 1`,
    [deploymentId, githubRepoId],
  )
  return result.rows[0] || null
}

export async function getMonorepoComparisonBase(
  deploymentId: number,
  githubRepoId: string,
  commitSha: string,
): Promise<{ commit_sha: string; created_at: Date } | null> {
  const result = await pool.query(
    `WITH active_repo_per_app AS MATERIALIZED (
       ${LATEST_ACTIVE_REPOSITORY_LINK_SQL}
     )
     SELECT previous.commit_sha, previous.created_at
     FROM deployments current
     JOIN application_repositories current_deployment_ar
       ON current_deployment_ar.monitored_app_id = current.monitored_app_id
       AND current_deployment_ar.github_owner = current.detected_github_owner
       AND current_deployment_ar.github_repo_name = current.detected_github_repo_name
       AND current_deployment_ar.github_repo_id = $2
       AND current_deployment_ar.status IN ('active', 'historical')
     JOIN active_repo_per_app current_ar
       ON current_ar.monitored_app_id = current.monitored_app_id
       AND current_ar.github_repo_id = current_deployment_ar.github_repo_id
     JOIN deployments previous
       ON (previous.created_at, previous.id) < (current.created_at, current.id)
       AND previous.commit_sha != $3
     JOIN application_repositories previous_ar
       ON previous_ar.monitored_app_id = previous.monitored_app_id
       AND previous_ar.github_owner = previous.detected_github_owner
       AND previous_ar.github_repo_name = previous.detected_github_repo_name
       AND previous_ar.github_repo_id = current_ar.github_repo_id
       AND previous_ar.status IN ('active', 'historical')
     JOIN active_repo_per_app previous_current_ar
       ON previous_current_ar.monitored_app_id = previous.monitored_app_id
       AND previous_current_ar.github_repo_id = previous_ar.github_repo_id
     WHERE current.id = $1
       AND current.commit_sha = $3
       AND previous.commit_sha IS NOT NULL
       AND previous.four_eyes_status NOT IN (${NON_DIFFABLE_STATUSES_SQL})
       AND previous.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
       AND previous.commit_sha !~ '^refs/'
     ORDER BY previous.created_at DESC, previous.id DESC
     LIMIT 1`,
    [deploymentId, githubRepoId, commitSha],
  )
  return result.rows[0] || null
}

export async function getEffectiveComparisonBaseSha(
  deploymentId: number,
  githubRepoId: string,
  commitSha: string,
): Promise<string | null> {
  const result = await pool.query<{ comparison_range: { baseSha?: unknown; headSha?: unknown } | null }>(
    `SELECT result->'comparisonRange' AS comparison_range
     FROM verification_runs
     WHERE deployment_id = $1
     ORDER BY run_at DESC
     LIMIT 1`,
    [deploymentId],
  )
  const comparisonRange = result.rows[0]?.comparison_range
  if (
    comparisonRange?.headSha === commitSha &&
    (comparisonRange.baseSha === null || typeof comparisonRange.baseSha === 'string')
  ) {
    return comparisonRange.baseSha
  }

  return (await getMonorepoComparisonBase(deploymentId, githubRepoId, commitSha))?.commit_sha ?? null
}

export async function getCompareSnapshotForCommit(
  owner: string,
  repo: string,
  commitSha: string,
  expectedBaseSha?: string | null,
): Promise<{ data: unknown; base_sha: string } | null> {
  if (expectedBaseSha) {
    const result = await pool.query(
      `SELECT data, base_sha FROM github_compare_snapshots
       WHERE owner = $1 AND repo = $2 AND head_sha = $3 AND base_sha = $4
       ORDER BY fetched_at DESC LIMIT 1`,
      [owner, repo, commitSha, expectedBaseSha],
    )
    return result.rows[0] || null
  }

  const result = await pool.query(
    `SELECT data, base_sha FROM github_compare_snapshots
     WHERE owner = $1 AND repo = $2 AND head_sha = $3
       AND base_sha != head_sha
     ORDER BY fetched_at DESC LIMIT 1`,
    [owner, repo, commitSha],
  )
  return result.rows[0] || null
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

const MISSING_APPROVER_STATUS_EXCLUSIONS = `d.four_eyes_status NOT IN ('no_changes', 'verified_via_sibling', 'baseline', 'implicitly_approved')`

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

export async function findDeploymentIdsMissingApprover(deploymentIds: number[]): Promise<Set<number>> {
  if (deploymentIds.length === 0) return new Set()
  const result = await pool.query<{ id: number }>(
    `SELECT d.id FROM deployments d
     WHERE d.id = ANY($1) AND ${MISSING_APPROVER_CONDITIONS}`,
    [deploymentIds],
  )
  return new Set(result.rows.map((r) => r.id))
}

interface GlobalMissingApproverDeployment extends MissingApproverDeployment {
  team_slug: string
  app_name: string
}

export async function getApprovedDeploymentsMissingApproverForApps(
  monitoredAppIds: number[],
): Promise<GlobalMissingApproverDeployment[]> {
  if (monitoredAppIds.length === 0) return []
  const result = await pool.query<GlobalMissingApproverDeployment>(
    `SELECT d.id, d.commit_sha, d.four_eyes_status, d.environment_name,
            d.created_at, d.deployer_username,
            d.detected_github_owner, d.detected_github_repo_name,
            d.monitored_app_id, ${effectiveDefaultBranchSql('ma')} AS default_branch,
            d.team_slug, d.app_name
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     WHERE d.monitored_app_id = ANY($1)
       AND COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})
       AND ${MISSING_APPROVER_CONDITIONS}
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY d.created_at DESC`,
    [monitoredAppIds],
  )
  return result.rows
}

export async function getAllApprovedDeploymentsMissingApprover(): Promise<GlobalMissingApproverDeployment[]> {
  const result = await pool.query<GlobalMissingApproverDeployment>(
    `SELECT d.id, d.commit_sha, d.four_eyes_status, d.environment_name,
            d.created_at, d.deployer_username,
            d.detected_github_owner, d.detected_github_repo_name,
            d.monitored_app_id, ${effectiveDefaultBranchSql('ma')} AS default_branch,
            d.team_slug, d.app_name
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     WHERE ma.is_active = true
       AND COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})
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

export async function getMissingApproverSummary(): Promise<{
  total: number
  byApp: MissingApproverSummary[]
}> {
  const result = await pool.query<MissingApproverSummary>(
    `SELECT d.team_slug, d.environment_name, d.app_name, COUNT(*)::int AS count
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     WHERE ma.is_active = true
       AND COALESCE(d.four_eyes_status, 'unknown') IN (${APPROVED_STATUSES_SQL})
       AND ${MISSING_APPROVER_CONDITIONS}
       AND ${AUDIT_START_YEAR_FILTER}
     GROUP BY d.team_slug, d.environment_name, d.app_name
     ORDER BY d.team_slug, d.environment_name, d.app_name`,
  )
  const total = result.rows.reduce((sum, r) => sum + r.count, 0)
  return { total, byApp: result.rows }
}
