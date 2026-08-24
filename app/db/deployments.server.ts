import { notApprovedWhereClause, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import type { WorkflowTriggerConfig } from '~/lib/github'
import { baselineActionSql } from './baseline-action'
import { pool } from './connection.server'
import { lowerUsernames, userDeploymentMatchAnySql } from './user-deployment-match'

export const TITLE_COALESCE_SQL = `COALESCE(d.title, d.github_pr_data->>'title', c.original_pr_title, c.message, d.unverified_commits->0->>'message')`

export interface UnverifiedCommit {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
  pr_number: number | null
  reason: string
}

export interface Deployment {
  id: number
  monitored_app_id: number
  nais_deployment_id: string
  created_at: Date
  deployer_username: string | null
  commit_sha: string | null
  trigger_url: string | null
  detected_github_owner: string
  detected_github_repo_name: string
  four_eyes_status: string
  github_pr_number: number | null
  github_pr_url: string | null
  github_pr_data: GitHubPRData | null
  commit_checks_data: CommitChecksData | null
  branch_name: string | null
  parent_commits: Array<{ sha: string }> | null
  unverified_commits: UnverifiedCommit[] | null
  resources: any
  synced_at: Date
  title: string | null
  slack_message_ts: string | null
  slack_channel_id: string | null
  slack_deploy_message_ts: string | null
  workflow_trigger_config: (Omit<WorkflowTriggerConfig, 'schemaVersion'> & { schemaVersion?: number }) | null
}

export interface GitHubPRData {
  [key: string]: unknown
  title: string
  body: string | null
  labels: string[]
  created_at: string
  merged_at: string | null
  base_branch: string
  base_sha: string
  head_branch: string
  head_sha: string
  merge_commit_sha: string | null
  commits_count: number
  changed_files: number
  additions: number
  deletions: number
  comments_count: number
  review_comments_count: number
  draft: boolean
  mergeable: boolean | null
  mergeable_state: string | null
  rebaseable: boolean | null
  locked: boolean
  maintainer_can_modify: boolean
  auto_merge: {
    enabled_by: string
    merge_method: string
  } | null
  creator: {
    username: string
    avatar_url: string
  }
  merged_by: {
    username: string
    avatar_url: string
  } | null
  merger: {
    username: string
    avatar_url: string
  } | null
  assignees: Array<{
    username: string
    avatar_url: string
  }>
  requested_reviewers: Array<{
    username: string
    avatar_url: string
  }>
  requested_teams: Array<{
    name: string
    slug: string
  }>
  milestone: {
    title: string
    number: number
    state: string
  } | null
  reviewers: Array<{
    username: string
    avatar_url: string
    state: string
    submitted_at: string
    commit_id: string | null
  }>
  checks_passed: boolean | null
  checks_ref?: 'merge_commit' | 'head' | null
  checks: Array<{
    id?: number
    name: string
    status: string
    conclusion: string | null
    started_at: string | null
    completed_at: string | null
    html_url: string | null
    head_sha?: string
    details_url?: string | null
    external_id?: string | null
    check_suite_id?: number | null
    app?: {
      name: string
      slug: string | null
    } | null
    output?: {
      title: string | null
      summary: string | null
      text: string | null
      annotations_count: number
    } | null
    log_cached?: boolean
    annotations?: Array<{
      path: string | null
      start_line: number
      end_line: number
      start_column: number | null
      end_column: number | null
      annotation_level: string
      message: string
      title: string | null
      raw_details: string | null
    }> | null
  }>
  commits: Array<{
    sha: string
    message: string
    author: {
      username: string
      login: string | null
      avatar_url: string
    }
    date: string
    committer_date: string
    parent_shas: string[]
    html_url: string
  }>
  unreviewed_commits?: Array<{
    sha: string
    message: string
    author: string
    date: string
    html_url: string
    reason: string
  }>
  comments: Array<{
    id: number
    body: string
    user: {
      username: string
      avatar_url: string
    }
    created_at: string
    html_url: string
  }>
}

export interface CommitChecksData {
  checked_sha: string
  checks_passed: boolean | null
  checks: GitHubPRData['checks']
}

export interface DeploymentWithApp extends Deployment {
  team_slug: string
  environment_name: string
  app_name: string
  default_branch: string | null
  has_goal_link?: boolean
}

export interface CreateDeploymentParams {
  monitoredApplicationId: number
  naisDeploymentId: string
  createdAt: Date
  teamSlug: string
  environmentName: string
  appName: string
  deployerUsername: string | null
  commitSha: string | null
  triggerUrl: string | null
  detectedGithubOwner: string
  detectedGithubRepoName: string
  resources?: any
}

export interface DeploymentFilters {
  monitored_app_id?: number
  monitored_app_ids?: number[]
  team_slug?: string
  environment_name?: string
  start_date?: Date
  end_date?: Date
  four_eyes_status?: string
  only_missing_four_eyes?: boolean
  deployer_username?: string
  deployer_usernames?: string[]
  exclude_deployer_usernames?: string[]
  unmapped_deployers?: boolean
  commit_sha?: string
  method?: 'pr' | 'direct_push' | 'legacy'
  workflow_trigger_event?: string
  workflow_path?: string
  goal_filter?: 'missing' | 'linked'
  goal_objective_id?: number
  goal_key_result_id?: number
  goal_dev_team_id?: number
  page?: number
  per_page?: number
  audit_start_year?: number | null
  per_app_audit_start_year?: boolean
}

interface PaginatedDeployments {
  deployments: DeploymentWithApp[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export async function getAllDeployments(filters?: DeploymentFilters): Promise<DeploymentWithApp[]> {
  const result = await getDeploymentsPaginated(filters)
  return result.deployments
}

export async function getDeploymentsPaginated(filters?: DeploymentFilters): Promise<PaginatedDeployments> {
  let whereSql = ' WHERE 1=1'
  const params: any[] = []
  let paramIndex = 1

  if (filters?.monitored_app_id) {
    whereSql += ` AND d.monitored_app_id = $${paramIndex}`
    params.push(filters.monitored_app_id)
    paramIndex++
  }

  if (filters?.monitored_app_ids && filters.monitored_app_ids.length > 0) {
    whereSql += ` AND d.monitored_app_id = ANY($${paramIndex})`
    params.push(filters.monitored_app_ids)
    paramIndex++
  }

  if (filters?.team_slug) {
    whereSql += ` AND ma.team_slug = $${paramIndex}`
    params.push(filters.team_slug)
    paramIndex++
  }

  if (filters?.environment_name) {
    whereSql += ` AND ma.environment_name = $${paramIndex}`
    params.push(filters.environment_name)
    paramIndex++
  }

  if (filters?.per_app_audit_start_year) {
    whereSql += ` AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))`
  } else if (filters?.audit_start_year) {
    whereSql += ` AND d.created_at >= make_date($${paramIndex}, 1, 1)`
    params.push(filters.audit_start_year)
    paramIndex++
  }

  if (filters?.start_date) {
    whereSql += ` AND d.created_at >= $${paramIndex}`
    params.push(filters.start_date)
    paramIndex++
  }

  if (filters?.end_date) {
    whereSql += ` AND d.created_at <= $${paramIndex}`
    params.push(filters.end_date)
    paramIndex++
  }

  if (filters?.four_eyes_status) {
    if (filters.four_eyes_status === 'not_approved') {
      whereSql += ` AND ${notApprovedWhereClause('d.four_eyes_status')}`
    } else if (filters.four_eyes_status === 'pending') {
      whereSql += ` AND COALESCE(d.four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL})`
    } else if (filters.four_eyes_status === 'baseline_action') {
      whereSql += ` AND ${baselineActionSql('d')}`
    } else {
      whereSql += ` AND d.four_eyes_status = $${paramIndex}`
      params.push(filters.four_eyes_status)
      paramIndex++
    }
  }

  if (filters?.deployer_username) {
    whereSql += ` AND d.deployer_username = $${paramIndex}`
    params.push(filters.deployer_username)
    paramIndex++
  }

  if (filters?.deployer_usernames !== undefined) {
    if (filters.deployer_usernames.length === 0) {
      whereSql += ' AND FALSE'
    } else {
      whereSql += ` AND ${userDeploymentMatchAnySql(paramIndex)}`
      params.push(lowerUsernames(filters.deployer_usernames))
      paramIndex++
    }
  }

  if (filters?.unmapped_deployers) {
    whereSql += ` AND d.deployer_username IS NOT NULL AND d.deployer_username != ''
      AND NOT EXISTS (
        SELECT 1 FROM user_github_accounts uga
        WHERE LOWER(uga.github_username) = LOWER(d.deployer_username) AND uga.deleted_at IS NULL
      )`
  }

  if (filters?.exclude_deployer_usernames !== undefined && filters.exclude_deployer_usernames.length > 0) {
    whereSql += ` AND NOT COALESCE(${userDeploymentMatchAnySql(paramIndex)}, FALSE)`
    params.push(lowerUsernames(filters.exclude_deployer_usernames))
    paramIndex++
  }

  if (filters?.commit_sha) {
    whereSql += ` AND d.commit_sha ILIKE $${paramIndex}`
    params.push(`%${filters.commit_sha}%`)
    paramIndex++
  }

  if (filters?.method === 'pr') {
    whereSql += ' AND d.github_pr_number IS NOT NULL'
  } else if (filters?.method === 'direct_push') {
    whereSql += ` AND d.github_pr_number IS NULL AND d.four_eyes_status != 'legacy'`
  } else if (filters?.method === 'legacy') {
    whereSql += ` AND d.four_eyes_status = 'legacy'`
  }

  if (filters?.workflow_trigger_event) {
    whereSql += ` AND d.workflow_trigger_config ->> 'triggerEvent' = $${paramIndex}`
    params.push(filters.workflow_trigger_event)
    paramIndex++
  }

  if (filters?.workflow_path) {
    whereSql += ` AND d.workflow_trigger_config ->> 'workflowPath' = $${paramIndex}`
    params.push(filters.workflow_path)
    paramIndex++
  }

  const needsGoalJoin =
    filters?.goal_filter != null || filters?.goal_objective_id != null || filters?.goal_key_result_id != null
  let goalJoinSql = ''
  if (needsGoalJoin && filters?.goal_objective_id) {
    whereSql += ` AND EXISTS (
      SELECT 1 FROM deployment_goal_links dgl
      LEFT JOIN board_key_results bkr_f ON bkr_f.id = dgl.key_result_id
      WHERE dgl.deployment_id = d.id AND dgl.is_active = true
        AND (dgl.objective_id = $${paramIndex} OR bkr_f.objective_id = $${paramIndex})
    )`
    params.push(filters.goal_objective_id)
    paramIndex++
  } else if (needsGoalJoin && filters?.goal_key_result_id) {
    whereSql += ` AND EXISTS (
      SELECT 1 FROM deployment_goal_links dgl
      WHERE dgl.deployment_id = d.id AND dgl.is_active = true
        AND dgl.key_result_id = $${paramIndex}
    )`
    params.push(filters.goal_key_result_id)
    paramIndex++
  } else if (needsGoalJoin && filters?.goal_dev_team_id) {
    goalJoinSql = `LEFT JOIN (
      SELECT DISTINCT dgl.deployment_id
      FROM deployment_goal_links dgl
      LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
      LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
      LEFT JOIN board_objectives bo_via_kr ON bo_via_kr.id = bkr.objective_id
      LEFT JOIN boards b ON b.id = COALESCE(bo.board_id, bo_via_kr.board_id)
      WHERE dgl.is_active = true
        AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
        AND b.dev_team_id = $${paramIndex}
        AND b.is_active = true
        AND COALESCE(bo.is_active, bo_via_kr.is_active, true) = true
    ) dgl ON dgl.deployment_id = d.id`
    params.push(filters.goal_dev_team_id)
    paramIndex++
  } else if (needsGoalJoin) {
    goalJoinSql =
      'LEFT JOIN (SELECT DISTINCT deployment_id FROM deployment_goal_links WHERE is_active = true AND (objective_id IS NOT NULL OR key_result_id IS NOT NULL)) dgl ON dgl.deployment_id = d.id'
  }

  if (!filters?.goal_objective_id && !filters?.goal_key_result_id) {
    if (filters?.goal_filter === 'missing') {
      whereSql += ' AND dgl.deployment_id IS NULL'
    } else if (filters?.goal_filter === 'linked') {
      whereSql += ' AND dgl.deployment_id IS NOT NULL'
    }
  }

  const countSql = `
    SELECT COUNT(*) as total
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    ${goalJoinSql}
    ${whereSql}
  `
  const countResult = await pool.query(countSql, params)
  const total = parseInt(countResult.rows[0].total, 10)

  const page = filters?.page || 1
  const per_page = filters?.per_page || 20
  const offset = (page - 1) * per_page

  const dataSql = `
    SELECT 
      d.*,
      ${TITLE_COALESCE_SQL} AS title,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.default_branch,
      EXISTS (SELECT 1 FROM deployment_goal_links WHERE deployment_id = d.id AND is_active = true AND (objective_id IS NOT NULL OR key_result_id IS NOT NULL)) AS has_goal_link
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    LEFT JOIN commits c ON c.sha = d.commit_sha
      AND c.repo_owner = d.detected_github_owner
      AND c.repo_name = d.detected_github_repo_name
    ${goalJoinSql}
    ${whereSql}
    ORDER BY d.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `
  params.push(per_page, offset)

  const result = await pool.query(dataSql, params)

  return {
    deployments: result.rows,
    total,
    page,
    per_page,
    total_pages: Math.ceil(total / per_page),
  }
}

function backfillChecksRef(prData: GitHubPRData): GitHubPRData {
  if (prData.checks_ref !== undefined) return prData
  if (!prData.merged_at || !prData.merge_commit_sha || !prData.checks?.length) {
    return { ...prData, checks_ref: null }
  }
  const refSha = prData.checks.find((c) => c.head_sha)?.head_sha
  if (!refSha) return { ...prData, checks_ref: 'head' }
  if (refSha === prData.merge_commit_sha) return { ...prData, checks_ref: 'merge_commit' }
  if (refSha === prData.head_sha) return { ...prData, checks_ref: 'head' }
  return { ...prData, checks_ref: null }
}

export async function getDeploymentById(id: number): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `SELECT 
      d.*,
      ${TITLE_COALESCE_SQL} AS title,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.default_branch
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    LEFT JOIN commits c ON c.sha = d.commit_sha
      AND c.repo_owner = d.detected_github_owner
      AND c.repo_name = d.detected_github_repo_name
    WHERE d.id = $1`,
    [id],
  )
  const row = result.rows[0] || null
  if (row?.github_pr_data) {
    row.github_pr_data = backfillChecksRef(row.github_pr_data)
  }
  return row
}

export async function getDeploymentByNaisId(naisDeploymentId: string): Promise<Deployment | null> {
  const result = await pool.query('SELECT * FROM deployments WHERE nais_deployment_id = $1', [naisDeploymentId])
  return result.rows[0] || null
}

export async function createDeployment(data: CreateDeploymentParams): Promise<Deployment> {
  const legacyCutoffDate = new Date('2025-01-01T00:00:00Z')
  const isLegacyDeployment = !data.commitSha || (data.createdAt < legacyCutoffDate && !data.commitSha)

  const result = await pool.query(
    `INSERT INTO deployments 
      (monitored_app_id, nais_deployment_id, created_at, team_slug, environment_name, app_name,
       deployer_username, commit_sha, trigger_url,
       detected_github_owner, detected_github_repo_name, resources, four_eyes_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (nais_deployment_id) 
    DO UPDATE SET
      resources = EXCLUDED.resources,
      synced_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      data.monitoredApplicationId,
      data.naisDeploymentId,
      data.createdAt,
      data.teamSlug,
      data.environmentName,
      data.appName,
      data.deployerUsername,
      data.commitSha,
      data.triggerUrl,
      data.detectedGithubOwner,
      data.detectedGithubRepoName,
      data.resources ? JSON.stringify(data.resources) : null,
      isLegacyDeployment ? 'legacy' : 'pending',
    ],
  )
  return result.rows[0]
}

export async function getLatestDeploymentForApp(
  monitoredAppId: number,
): Promise<{ nais_deployment_id: string; created_at: string } | null> {
  const result = await pool.query(
    `SELECT nais_deployment_id, created_at 
     FROM deployments 
     WHERE monitored_app_id = $1 
     ORDER BY created_at DESC 
     LIMIT 1`,
    [monitoredAppId],
  )
  return result.rows[0] || null
}

export {
  getVerificationStats,
  updateDeploymentFourEyes,
  updateDeploymentLegacyData,
} from './deployments/four-eyes.server'

async function _getPreviousDeployment(
  currentDeploymentId: number,
  repoOwner: string,
  repoName: string,
  environmentName: string,
  auditStartYear?: number | null,
): Promise<Deployment | null> {
  let sql = `SELECT prev_dep.* FROM deployments prev_dep
     CROSS JOIN deployments curr_dep
     JOIN monitored_applications ma ON prev_dep.monitored_app_id = ma.id
     WHERE prev_dep.detected_github_owner = $1
       AND prev_dep.detected_github_repo_name = $2
       AND ma.environment_name = $3
       AND curr_dep.id = $4
       AND prev_dep.created_at < curr_dep.created_at
       AND prev_dep.commit_sha IS NOT NULL`

  const params: any[] = [repoOwner, repoName, environmentName, currentDeploymentId]

  if (auditStartYear) {
    sql += ` AND EXTRACT(YEAR FROM prev_dep.created_at) >= $5`
    params.push(auditStartYear)
  }

  sql += ` ORDER BY prev_dep.created_at DESC LIMIT 1`

  const result = await pool.query(sql, params)

  return result.rows[0] || null
}

export type { DeployerMonthlyStats, DeployerTableFilters } from './deployer-stats.server'
export {
  getDeployerApps,
  getDeployerDeploymentsPaginated,
  getDeployerMonthlyStats,
  getDeploymentCountByDeployer,
} from './deployer-stats.server'
export { getAppChangeOriginCoverage, getLastDeploymentSummary } from './deployments/api.server'
export { getBaselineMoveContext, moveBaselineToDeployment } from './deployments/baseline-move.server'
export { getPersonalDeploymentsMissingGoalLinks } from './deployments/home.server'
export type { DeploymentNavFilters } from './deployments/navigation.server'
export {
  getNextDeployment,
  getPreviousDeploymentForDiff,
  getPreviousDeploymentForNav,
} from './deployments/navigation.server'
export {
  claimDeploymentForDeployNotify,
  claimDeploymentForSlackNotification,
  claimReminderSend,
  getAppsWithRemindersEnabled,
  getDeploymentsNeedingDeployNotify,
  getUnapprovedDeployments,
} from './deployments/notifications.server'
export type { SearchResult } from './deployments/search.server'
export { searchDeployments } from './deployments/search.server'
export {
  getAppDeploymentStats,
  getAppDeploymentStatsBatch,
  getPendingVerificationCount,
} from './deployments/stats.server'
export {
  getDeploymentsWithStatusChanges,
  getStatusHistory,
  logStatusTransition,
  recordBaselineApproval,
} from './deployments/status-history.server'
