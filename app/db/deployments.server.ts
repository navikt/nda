import { NOT_APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'
import { pool } from './connection.server'
import { logStatusTransition } from './deployments/status-history.server'

export interface UnverifiedCommit {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
  pr_number: number | null
  reason: string // 'no_pr' | 'pr_not_approved' | 'pr_not_found'
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
  has_four_eyes: boolean
  four_eyes_status: string
  github_pr_number: number | null
  github_pr_url: string | null
  github_pr_data: GitHubPRData | null
  branch_name: string | null
  parent_commits: Array<{ sha: string }> | null
  unverified_commits: UnverifiedCommit[] | null
  resources: any // JSONB
  synced_at: Date
  title: string | null
  slack_message_ts: string | null
  slack_channel_id: string | null
  slack_deploy_message_ts: string | null
}

export interface GitHubPRData {
  title: string
  body: string | null
  labels: string[]
  created_at: string
  merged_at: string | null
  base_branch: string
  base_sha: string // Base commit SHA that PR branched from
  head_branch: string // PR branch name
  head_sha: string // Latest commit SHA in PR
  merge_commit_sha: string | null // SHA of merge/squash commit
  commits_count: number
  changed_files: number
  additions: number
  deletions: number
  comments_count: number
  review_comments_count: number
  draft: boolean
  mergeable: boolean | null
  mergeable_state: string | null // 'clean', 'dirty', 'blocked', 'behind', 'unstable'
  rebaseable: boolean | null
  locked: boolean
  maintainer_can_modify: boolean
  auto_merge: {
    enabled_by: string
    merge_method: string // 'merge', 'squash', 'rebase'
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
    state: string // 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'
    submitted_at: string
  }>
  checks_passed: boolean | null
  checks: Array<{
    id?: number
    name: string
    status: string // 'queued', 'in_progress', 'completed'
    conclusion: string | null // 'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral'
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
      avatar_url: string
    }
    date: string
    html_url: string
  }>
  unreviewed_commits?: Array<{
    sha: string
    message: string
    author: string
    date: string
    html_url: string
    reason: string // Why it's unreviewed: 'no_pr', 'pr_not_approved', etc
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

export interface DeploymentWithApp extends Deployment {
  team_slug: string
  environment_name: string
  app_name: string
  default_branch: string
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
  only_repository_mismatch?: boolean
  deployer_username?: string
  commit_sha?: string
  method?: 'pr' | 'direct_push' | 'legacy'
  page?: number
  per_page?: number
  audit_start_year?: number | null
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

  // Filter by audit start year
  if (filters?.audit_start_year) {
    whereSql += ` AND EXTRACT(YEAR FROM d.created_at) >= $${paramIndex}`
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
      whereSql += ` AND d.four_eyes_status = ANY($${paramIndex})`
      params.push(NOT_APPROVED_STATUSES)
      paramIndex++
    } else if (filters.four_eyes_status === 'pending') {
      whereSql += ` AND d.four_eyes_status = ANY($${paramIndex})`
      params.push(PENDING_STATUSES)
      paramIndex++
    } else {
      whereSql += ` AND d.four_eyes_status = $${paramIndex}`
      params.push(filters.four_eyes_status)
      paramIndex++
    }
  }

  if (filters?.only_repository_mismatch) {
    whereSql += ` AND d.four_eyes_status = 'repository_mismatch'`
  }

  if (filters?.deployer_username) {
    whereSql += ` AND d.deployer_username ILIKE $${paramIndex}`
    params.push(`%${filters.deployer_username}%`)
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

  // Count total
  const countSql = `
    SELECT COUNT(*) as total
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    ${whereSql}
  `
  const countResult = await pool.query(countSql, params)
  const total = parseInt(countResult.rows[0].total, 10)

  // Pagination
  const page = filters?.page || 1
  const per_page = filters?.per_page || 20
  const offset = (page - 1) * per_page

  const dataSql = `
    SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.default_branch
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
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

export async function getDeploymentById(id: number): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      ma.default_branch
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.id = $1`,
    [id],
  )
  return result.rows[0] || null
}

export async function getDeploymentByNaisId(naisDeploymentId: string): Promise<Deployment | null> {
  const result = await pool.query('SELECT * FROM deployments WHERE nais_deployment_id = $1', [naisDeploymentId])
  return result.rows[0] || null
}

export async function createDeployment(data: CreateDeploymentParams): Promise<Deployment> {
  // Check if this is a legacy deployment:
  // - Before 2025-01-01 without commit SHA, OR
  // - Any deployment without commit SHA (cannot be verified)
  const legacyCutoffDate = new Date('2025-01-01T00:00:00Z')
  const isLegacyDeployment = !data.commitSha || (data.createdAt < legacyCutoffDate && !data.commitSha)

  const result = await pool.query(
    `INSERT INTO deployments 
      (monitored_app_id, nais_deployment_id, created_at, team_slug, environment_name, app_name,
       deployer_username, commit_sha, trigger_url,
       detected_github_owner, detected_github_repo_name, resources, has_four_eyes, four_eyes_status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      isLegacyDeployment, // has_four_eyes = true for legacy
      isLegacyDeployment ? 'legacy' : 'pending', // four_eyes_status
    ],
  )
  return result.rows[0]
}

/**
 * Get the latest (most recent) deployment for an app by Nais deployment ID
 * Used for incremental sync to know where to stop
 */
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

export async function getVerificationStats(monitoredAppId?: number): Promise<{
  total: number
  needsVerification: number
  pending: number
  error: number
}> {
  let sql = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN four_eyes_status = ANY($1) THEN 1 END) as pending,
      COUNT(CASE WHEN four_eyes_status = 'error' THEN 1 END) as error
    FROM deployments
  `

  const params: any[] = [PENDING_STATUSES]
  if (monitoredAppId) {
    sql += ' WHERE monitored_app_id = $2'
    params.push(monitoredAppId)
  }

  const result = await pool.query(sql, params)
  const pending = parseInt(result.rows[0].pending, 10)
  const error = parseInt(result.rows[0].error, 10)

  return {
    total: parseInt(result.rows[0].total, 10),
    needsVerification: pending + error,
    pending,
    error,
  }
}

export async function updateDeploymentFourEyes(
  deploymentId: number,
  data: {
    hasFourEyes: boolean
    fourEyesStatus: string
    githubPrNumber: number | null
    githubPrUrl: string | null
    githubPrData?: GitHubPRData | null
    branchName?: string | null
    parentCommits?: Array<{ sha: string }> | null
    unverifiedCommits?: UnverifiedCommit[] | null
    title?: string | null
  },
  statusChangeOptions?: {
    changeSource: string
    changedBy?: string
    details?: Record<string, unknown>
  },
): Promise<Deployment> {
  // Get current status before update for history logging
  const current = await pool.query(`SELECT four_eyes_status, has_four_eyes FROM deployments WHERE id = $1`, [
    deploymentId,
  ])

  const result = await pool.query(
    `UPDATE deployments 
     SET has_four_eyes = $1,
         four_eyes_status = $2,
         github_pr_number = $3,
         github_pr_url = $4,
         github_pr_data = $5,
         branch_name = $6,
         parent_commits = $7,
         unverified_commits = $8,
         title = $9
     WHERE id = $10
     RETURNING *`,
    [
      data.hasFourEyes,
      data.fourEyesStatus,
      data.githubPrNumber,
      data.githubPrUrl,
      data.githubPrData ? JSON.stringify(data.githubPrData) : null,
      data.branchName || null,
      data.parentCommits ? JSON.stringify(data.parentCommits) : null,
      data.unverifiedCommits ? JSON.stringify(data.unverifiedCommits) : null,
      data.title || null,
      deploymentId,
    ],
  )

  if (result.rows.length === 0) {
    throw new Error('Deployment not found')
  }

  // Log status transition if status actually changed
  if (current.rows.length > 0) {
    const prev = current.rows[0]
    if (prev.four_eyes_status !== data.fourEyesStatus || prev.has_four_eyes !== data.hasFourEyes) {
      const source = statusChangeOptions?.changeSource || 'unknown'
      await logStatusTransition(deploymentId, {
        fromStatus: prev.four_eyes_status,
        toStatus: data.fourEyesStatus,
        fromHasFourEyes: prev.has_four_eyes,
        toHasFourEyes: data.hasFourEyes,
        changeSource: source,
        changedBy: statusChangeOptions?.changedBy,
        details: statusChangeOptions?.details,
      })
    }
  }

  return result.rows[0]
}

/**
 * Update deployment with data fetched from GitHub for legacy verification
 */
export async function updateDeploymentLegacyData(
  deploymentId: number,
  data: {
    commitSha: string | null
    commitMessage: string | null
    deployer: string | null
    mergedBy: string | null
    prNumber: number | null
    prUrl: string | null
    prTitle: string | null
    prAuthor: string | null
    prMergedAt: string | null
    reviewers: Array<{ username: string; state: string }>
  },
): Promise<Deployment> {
  // Use mergedBy as deployer if available, otherwise fall back to deployer/commitAuthor
  const effectiveDeployer = data.mergedBy || data.deployer

  // For legacy, we store reviewers directly in a simplified github_pr_data
  // Build a minimal structure that matches type requirements
  let githubPrDataStr: string | null = null
  if (data.prNumber || data.reviewers.length > 0) {
    // Store all available data for legacy verification
    const prData = {
      title: data.prTitle || data.commitMessage || '',
      number: data.prNumber,
      html_url: data.prUrl,
      user: data.prAuthor ? { login: data.prAuthor } : null,
      merged_by: data.mergedBy ? { login: data.mergedBy } : null,
      merged_at: data.prMergedAt,
      reviewers: data.reviewers.map((r) => ({
        username: r.username,
        avatar_url: '',
        state: r.state,
        submitted_at: new Date().toISOString(),
      })),
      // Mark as legacy-verified data
      _legacy_verified: true,
    }
    githubPrDataStr = JSON.stringify(prData)
  }

  const result = await pool.query(
    `UPDATE deployments 
     SET commit_sha = COALESCE($1, commit_sha),
         deployer_username = COALESCE($2, deployer_username),
         github_pr_number = $3,
         github_pr_url = $4,
         github_pr_data = COALESCE($5::jsonb, github_pr_data),
         title = COALESCE($6, title)
     WHERE id = $7
     RETURNING *`,
    [
      data.commitSha,
      effectiveDeployer,
      data.prNumber,
      data.prUrl,
      githubPrDataStr,
      data.prTitle || data.commitMessage,
      deploymentId,
    ],
  )

  if (result.rows.length === 0) {
    throw new Error('Deployment not found')
  }

  return result.rows[0]
}

/**
 * Get the deployment that happened before this one for the same repo/environment
 * Uses created_at for ordering (not id, which isn't guaranteed chronological)
 */
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

  // Filter out deployments before audit start year
  if (auditStartYear) {
    sql += ` AND EXTRACT(YEAR FROM prev_dep.created_at) >= $5`
    params.push(auditStartYear)
  }

  sql += ` ORDER BY prev_dep.created_at DESC LIMIT 1`

  const result = await pool.query(sql, params)

  return result.rows[0] || null
}

/**
 * Navigation filter options for prev/next deployment
 */
export interface DeploymentNavFilters {
  four_eyes_status?: string
  method?: 'pr' | 'direct_push' | 'legacy'
  deployer_username?: string
  commit_sha?: string
  start_date?: Date
  end_date?: Date
  audit_start_year?: number | null
}

/**
 * Build WHERE clause conditions for navigation filters
 */
function buildNavFilterConditions(
  filters: DeploymentNavFilters,
  startParamIndex: number,
): { conditions: string[]; params: any[]; nextIndex: number } {
  const conditions: string[] = []
  const params: any[] = []
  let idx = startParamIndex

  if (filters.four_eyes_status) {
    // Handle meta-statuses that map to multiple four_eyes_status values
    if (filters.four_eyes_status === 'not_approved') {
      conditions.push(`nav_dep.four_eyes_status = ANY($${idx})`)
      params.push(NOT_APPROVED_STATUSES)
      idx++
    } else if (filters.four_eyes_status === 'pending') {
      conditions.push(`nav_dep.four_eyes_status = ANY($${idx})`)
      params.push(PENDING_STATUSES)
      idx++
    } else {
      conditions.push(`nav_dep.four_eyes_status = $${idx}`)
      params.push(filters.four_eyes_status)
      idx++
    }
  }

  if (filters.method === 'pr') {
    conditions.push('nav_dep.github_pr_number IS NOT NULL')
  } else if (filters.method === 'direct_push') {
    conditions.push("nav_dep.github_pr_number IS NULL AND nav_dep.four_eyes_status != 'legacy'")
  } else if (filters.method === 'legacy') {
    conditions.push("nav_dep.four_eyes_status = 'legacy'")
  }

  if (filters.deployer_username) {
    conditions.push(`nav_dep.deployer_username ILIKE $${idx}`)
    params.push(`%${filters.deployer_username}%`)
    idx++
  }

  if (filters.commit_sha) {
    conditions.push(`nav_dep.commit_sha ILIKE $${idx}`)
    params.push(`%${filters.commit_sha}%`)
    idx++
  }

  if (filters.start_date) {
    conditions.push(`nav_dep.created_at >= $${idx}`)
    params.push(filters.start_date)
    idx++
  }

  if (filters.end_date) {
    conditions.push(`nav_dep.created_at <= $${idx}`)
    params.push(filters.end_date)
    idx++
  }

  if (filters.audit_start_year) {
    conditions.push(`EXTRACT(YEAR FROM nav_dep.created_at) >= $${idx}`)
    params.push(filters.audit_start_year)
    idx++
  }

  return { conditions, params, nextIndex: idx }
}

/**
 * Get the next deployment (chronologically newer) for navigation
 * Next = deployment that happened AFTER this one (newer created_at)
 */
export async function getNextDeployment(
  currentDeploymentId: number,
  monitoredAppId: number,
  filters: DeploymentNavFilters = {},
): Promise<Deployment | null> {
  const { conditions, params } = buildNavFilterConditions(filters, 3)

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

  const result = await pool.query(
    `SELECT nav_dep.* FROM deployments nav_dep
     CROSS JOIN deployments curr_dep
     WHERE nav_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND nav_dep.created_at > curr_dep.created_at
       ${whereClause}
     ORDER BY nav_dep.created_at ASC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId, ...params],
  )

  return result.rows[0] || null
}

/**
 * Get the previous deployment (chronologically older) for navigation
 * Previous = deployment that happened BEFORE this one (older created_at)
 */
export async function getPreviousDeploymentForNav(
  currentDeploymentId: number,
  monitoredAppId: number,
  filters: DeploymentNavFilters = {},
): Promise<Deployment | null> {
  const { conditions, params } = buildNavFilterConditions(filters, 3)

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

  const result = await pool.query(
    `SELECT nav_dep.* FROM deployments nav_dep
     CROSS JOIN deployments curr_dep
     WHERE nav_dep.monitored_app_id = $1
       AND curr_dep.id = $2
       AND nav_dep.created_at < curr_dep.created_at
       ${whereClause}
     ORDER BY nav_dep.created_at DESC
     LIMIT 1`,
    [monitoredAppId, currentDeploymentId, ...params],
  )

  return result.rows[0] || null
}

/**
 * Get the true chronologically previous deployment for GitHub diff links.
 * Unlike getPreviousDeploymentForNav, this ignores user filters (status, method, etc.)
 * to always return the actual previous deployment — deployments can arrive out of order,
 * so we use created_at, not id.
 */
export async function getPreviousDeploymentForDiff(
  currentDeploymentId: number,
  monitoredAppId: number,
  auditStartYear?: number | null,
): Promise<{ commit_sha: string } | null> {
  let sql = `SELECT prev.commit_sha FROM deployments prev
     CROSS JOIN deployments curr
     WHERE prev.monitored_app_id = $1
       AND curr.id = $2
       AND prev.created_at < curr.created_at
       AND prev.commit_sha IS NOT NULL
       AND prev.four_eyes_status NOT IN ('legacy', 'legacy_pending')
       AND prev.commit_sha !~ '^refs/'`

  const params: (number | string)[] = [monitoredAppId, currentDeploymentId]

  if (auditStartYear) {
    sql += ` AND prev.created_at >= make_date($3, 1, 1)`
    params.push(auditStartYear)
  }

  sql += ` ORDER BY prev.created_at DESC LIMIT 1`

  const result = await pool.query(sql, params)
  return result.rows[0] || null
}

export interface AppDeploymentStats {
  total: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  last_deployment: Date | null
  last_deployment_id: number | null
  four_eyes_percentage: number
}

/**
 * Get deployment count for a specific deployer
 */
export async function getDeploymentCountByDeployer(deployerUsername: string): Promise<number> {
  const result = await pool.query('SELECT COUNT(*) as count FROM deployments WHERE deployer_username = $1', [
    deployerUsername,
  ])
  return parseInt(result.rows[0].count, 10) || 0
}

/**
 * Get recent deployments for a specific deployer
 */
export async function getDeploymentsByDeployer(deployerUsername: string, limit = 5): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT 
      d.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.deployer_username = $1
    ORDER BY d.created_at DESC
    LIMIT $2`,
    [deployerUsername, limit],
  )
  return result.rows
}

export interface DeployerMonthlyStats {
  month: string
  total: number
  with_goal: number
  without_goal: number
  dependabot: number
}

/**
 * Get monthly deployment counts for a deployer, grouped by goal linkage and Dependabot
 */
export async function getDeployerMonthlyStats(
  deployerUsername: string,
  startDate?: Date | null,
  endDate?: Date | null,
): Promise<DeployerMonthlyStats[]> {
  let whereSql = 'WHERE d.deployer_username = $1'
  const params: (string | Date)[] = [deployerUsername]
  let paramIndex = 2

  if (startDate) {
    whereSql += ` AND d.created_at >= $${paramIndex}`
    params.push(startDate)
    paramIndex++
  } else {
    whereSql += ` AND d.created_at >= DATE_TRUNC('month', NOW()) - '24 months'::interval`
  }
  if (endDate) {
    whereSql += ` AND d.created_at <= $${paramIndex}`
    params.push(endDate)
  }

  const result = await pool.query(
    `SELECT
       TO_CHAR(DATE_TRUNC('month', d.created_at), 'YYYY-MM') AS month,
       COUNT(DISTINCT d.id)::int AS total,
       COUNT(DISTINCT d.id) FILTER (
         WHERE LOWER(d.github_pr_data->'creator'->>'username') = 'dependabot[bot]'
       )::int AS dependabot,
       COUNT(DISTINCT dgl.deployment_id) FILTER (
         WHERE LOWER(d.github_pr_data->'creator'->>'username') IS DISTINCT FROM 'dependabot[bot]'
       )::int AS with_goal_non_dep
     FROM deployments d
     LEFT JOIN deployment_goal_links dgl ON dgl.deployment_id = d.id
     ${whereSql}
     GROUP BY DATE_TRUNC('month', d.created_at)
     ORDER BY month`,
    params,
  )
  return result.rows.map((row: { month: string; total: number; dependabot: number; with_goal_non_dep: number }) => ({
    month: row.month,
    total: row.total,
    dependabot: row.dependabot,
    with_goal: row.with_goal_non_dep,
    without_goal: row.total - row.dependabot - row.with_goal_non_dep,
  }))
}

export interface DeployerDeploymentRow extends DeploymentWithApp {
  has_goal_link: boolean
  is_dependabot: boolean
}

export interface PaginatedDeployerDeployments {
  deployments: DeployerDeploymentRow[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

/**
 * Get paginated deployments for a deployer with goal-link indicator
 */
export async function getDeployerDeploymentsPaginated(
  deployerUsername: string,
  page = 1,
  perPage = 20,
  startDate?: Date | null,
  endDate?: Date | null,
): Promise<PaginatedDeployerDeployments> {
  const offset = (page - 1) * perPage

  let whereSql = 'WHERE d.deployer_username = $1'
  const countParams: (string | Date | number)[] = [deployerUsername]
  let paramIndex = 2

  if (startDate) {
    whereSql += ` AND d.created_at >= $${paramIndex}`
    countParams.push(startDate)
    paramIndex++
  }
  if (endDate) {
    whereSql += ` AND d.created_at <= $${paramIndex}`
    countParams.push(endDate)
    paramIndex++
  }

  const dataParams = [...countParams, perPage, offset]

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM deployments d ${whereSql}`, countParams),
    pool.query(
      `SELECT
         d.*,
         ma.team_slug,
         ma.environment_name,
         ma.app_name,
         EXISTS (SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = d.id) AS has_goal_link,
         LOWER(d.github_pr_data->'creator'->>'username') = 'dependabot[bot]' AS is_dependabot
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       ${whereSql}
       ORDER BY d.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams,
    ),
  ])

  const total = countResult.rows[0]?.total ?? 0

  return {
    deployments: dataResult.rows,
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  }
}

/**
 * Search result types for global search
 */
export interface SearchResult {
  type: 'deployment' | 'user' | 'team' | 'app'
  id?: number
  url: string
  title: string
  subtitle?: string
}

/**
 * Search deployments by ID, commit SHA, or deployer username
 */
export async function searchDeployments(query: string, limit = 10): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return results

  // Check if query is a Nais deployment ID (starts with DI_)
  if (/^DI_/i.test(trimmedQuery)) {
    const naisResult = await pool.query(
      `SELECT d.id, d.nais_deployment_id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.nais_deployment_id ILIKE $1
       ORDER BY d.created_at DESC
       LIMIT $2`,
      [`${trimmedQuery}%`, limit],
    )
    for (const row of naisResult.rows) {
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `Deployment #${row.id}`,
        subtitle: `${row.app_name} • ${row.nais_deployment_id.substring(0, 20)}...`,
      })
    }
    return results
  }

  // Check if query is a deployment ID (pure number)
  if (/^\d+$/.test(trimmedQuery)) {
    const deploymentId = parseInt(trimmedQuery, 10)
    const result = await pool.query(
      `SELECT d.id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.id = $1`,
      [deploymentId],
    )
    if (result.rows.length > 0) {
      const row = result.rows[0]
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `Deployment #${row.id}`,
        subtitle: `${row.app_name} • ${row.commit_sha?.substring(0, 7) || 'ukjent SHA'}`,
      })
    }
    return results
  }

  // Check if query looks like a SHA (hex characters only, at least 3 chars for typeahead)
  const looksLikeSha = /^[0-9a-f]{3,40}$/i.test(trimmedQuery)

  if (looksLikeSha) {
    const shaResult = await pool.query(
      `SELECT d.id, d.commit_sha, d.deployer_username, d.created_at,
              ma.team_slug, ma.environment_name, ma.app_name
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE d.commit_sha ILIKE $1
       ORDER BY d.created_at DESC
       LIMIT $2`,
      [`${trimmedQuery}%`, limit],
    )
    for (const row of shaResult.rows) {
      results.push({
        type: 'deployment',
        id: row.id,
        url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}/deployments/${row.id}`,
        title: `${row.commit_sha?.substring(0, 7)}`,
        subtitle: `${row.app_name} • ${row.deployer_username || 'ukjent'}`,
      })
    }
    // If we found SHA matches, return them (don't mix with user results)
    if (results.length > 0) {
      return results
    }
  }

  // Otherwise, search by deployer username OR user mapping fields (nav_ident, nav_email, display_name, slack_member_id)
  // Also search for teams and applications
  const [userResult, teamResult, appResult] = await Promise.all([
    pool.query(
      `SELECT DISTINCT d.deployer_username, 
              um.display_name, um.nav_email, um.nav_ident, um.slack_member_id,
              COUNT(*) as deployment_count
       FROM deployments d
       LEFT JOIN user_mappings um ON d.deployer_username = um.github_username
       WHERE d.deployer_username ILIKE $1
          OR um.display_name ILIKE $1
          OR um.nav_email ILIKE $1
          OR um.nav_ident ILIKE $1
          OR um.slack_member_id ILIKE $1
       GROUP BY d.deployer_username, um.display_name, um.nav_email, um.nav_ident, um.slack_member_id
       ORDER BY deployment_count DESC
       LIMIT $2`,
      [`%${trimmedQuery}%`, limit],
    ),
    pool.query(
      `SELECT DISTINCT ma.team_slug, COUNT(DISTINCT ma.app_name) AS app_count
       FROM monitored_applications ma
       WHERE ma.is_active = true AND ma.team_slug ILIKE $1
       GROUP BY ma.team_slug
       ORDER BY ma.team_slug
       LIMIT $2`,
      [`%${trimmedQuery}%`, limit],
    ),
    pool.query(
      `SELECT DISTINCT ma.app_name, ma.team_slug, ma.environment_name
       FROM monitored_applications ma
       WHERE ma.is_active = true AND ma.app_name ILIKE $1
       ORDER BY ma.app_name, ma.environment_name
       LIMIT $2`,
      [`%${trimmedQuery}%`, limit],
    ),
  ])

  for (const row of teamResult.rows) {
    results.push({
      type: 'team',
      url: `/team/${row.team_slug}`,
      title: row.team_slug,
      subtitle: `${row.app_count} applikasjon${row.app_count === 1 ? '' : 'er'}`,
    })
  }

  // Deduplicate apps across environments — show one result per app_name+team_slug
  const seenApps = new Set<string>()
  for (const row of appResult.rows) {
    const key = `${row.team_slug}/${row.app_name}`
    if (seenApps.has(key)) continue
    seenApps.add(key)
    results.push({
      type: 'app',
      url: `/team/${row.team_slug}/env/${row.environment_name}/app/${row.app_name}`,
      title: row.app_name,
      subtitle: row.team_slug,
    })
  }
  for (const row of userResult.rows) {
    // Show the most relevant matching field in the subtitle
    let matchInfo = ''
    const queryLower = trimmedQuery.toLowerCase()
    if (row.display_name?.toLowerCase().includes(queryLower)) {
      matchInfo = row.display_name
    } else if (row.nav_ident?.toLowerCase().includes(queryLower)) {
      matchInfo = `NAV-ident: ${row.nav_ident}`
    } else if (row.nav_email?.toLowerCase().includes(queryLower)) {
      matchInfo = row.nav_email
    } else if (row.slack_member_id?.toLowerCase().includes(queryLower)) {
      matchInfo = `Slack: ${row.slack_member_id}`
    }

    results.push({
      type: 'user',
      url: `/users/${row.deployer_username}`,
      title: row.display_name || row.deployer_username,
      subtitle: matchInfo
        ? `${row.deployer_username} • ${matchInfo} • ${row.deployment_count} deployment(s)`
        : `${row.deployer_username} • ${row.deployment_count} deployment(s)`,
    })
  }

  return results
}

export interface AppWithIssues {
  app_name: string
  team_slug: string
  environment_name: string
  without_four_eyes: number
  pending_verification: number
  alert_count: number
}

export interface IssueDeployment {
  id: number
  app_name: string
  team_slug: string
  environment_name: string
  commit_sha: string | null
  deployer_username: string | null
  four_eyes_status: string
  github_pr_number: number | null
  github_pr_data: GitHubPRData | null
  title: string | null
  created_at: Date
}

// =============================================================================
// Deployment Status History
// =============================================================================

export interface StatusTransition {
  id: number
  deployment_id: number
  from_status: string | null
  to_status: string
  from_has_four_eyes: boolean | null
  to_has_four_eyes: boolean
  changed_by: string | null
  change_source: string
  details: Record<string, unknown> | null
  created_at: Date
}

// =============================================================================
// Reminder queries
// =============================================================================

export interface AppReminderConfig {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  slack_channel_id: string
  reminder_time: string
  reminder_days: string[]
  reminder_last_sent_at: Date | null
}

export {
  getAppsWithIssues,
  getHomeTabSummaryStats,
  getIssueDeploymentsPerApp,
} from './deployments/home.server'
export {
  claimDeploymentForDeployNotify,
  claimDeploymentForSlackNotification,
  claimReminderSend,
  getAppsWithRemindersEnabled,
  getDeploymentsNeedingDeployNotify,
  getUnapprovedDeployments,
} from './deployments/notifications.server'
// Re-exports from submodules
export { getAppDeploymentStats, getAppDeploymentStatsBatch } from './deployments/stats.server'
export {
  getDeploymentsWithStatusChanges,
  getStatusHistory,
  logStatusTransition,
} from './deployments/status-history.server'
