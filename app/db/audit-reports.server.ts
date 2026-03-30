import { createHash } from 'node:crypto'
import type { ReportPeriodType } from '~/lib/report-periods'
import { generateReportId } from '~/lib/report-periods'
import { pool } from './connection.server'
import { getDeviationsForPeriod } from './deviations.server'

// ============================================================================
// Types
// ============================================================================

/**
 * Slim deployment row for audit reports - excludes large github_pr_data blob
 */
interface AuditDeploymentRow {
  id: number
  nais_deployment_id: string | null
  title: string | null
  created_at: Date
  commit_sha: string | null
  deployer_username: string | null
  four_eyes_status: string
  github_pr_number: number | null
  github_pr_url: string | null
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  team_slug: string
  environment_name: string
  app_name: string
  // Extracted from github_pr_data via SQL - array of all approved reviewers
  approved_by_usernames: string[] | null
  // Extracted from github_pr_data via SQL - PR author
  pr_author: string | null
  // JSONB column with unverified commits (if any)
  unverified_commits: UnverifiedCommitEntry[] | null
}

interface AuditReport {
  id: number
  report_id: string
  monitored_app_id: number
  app_name: string
  team_slug: string
  environment_name: string
  repository: string
  year: number
  period_type: ReportPeriodType
  period_label: string
  period_start: Date
  period_end: Date
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  unique_deployers: number
  unique_reviewers: number
  report_data: AuditReportData
  content_hash: string
  pdf_data: Buffer | null
  generated_at: Date
  generated_by: string | null
}

export interface AuditReportData {
  deployments: AuditDeploymentEntry[]
  manual_approvals: ManualApprovalEntry[]
  contributors: ContributorEntry[]
  reviewers: ReviewerEntry[]
  legacy_count: number
  deviations: DeviationEntry[]
  unverified_commit_deployments: UnverifiedCommitDeploymentEntry[]
}

export interface DeviationEntry {
  deployment_id: number
  date: string
  commit_sha: string
  reason: string
  breach_type: string | null
  intent: string | null
  severity: string | null
  follow_up_role: string | null
  registered_by: string
  registered_by_name: string | null
  resolved_at: string | null
  resolution_note: string | null
}

export interface AuditDeploymentEntry {
  id: number
  nais_deployment_id: string
  title: string
  date: string
  commit_sha: string
  method: 'pr' | 'manual' | 'legacy'
  pr_author?: string
  pr_author_display_name?: string
  deployer: string
  deployer_display_name?: string
  approver: string
  approver_display_name?: string
  pr_number?: number
  pr_url?: string
  slack_link?: string
}

export interface ManualApprovalEntry {
  deployment_id: number
  nais_deployment_id: string
  title: string
  date: string
  commit_sha: string
  deployer: string
  deployer_display_name?: string
  reason: string
  registered_by: string
  registered_by_display_name?: string
  approved_by: string
  approved_by_display_name?: string
  approved_at: string
  slack_link: string
  comment: string
}

export interface ContributorEntry {
  github_username: string
  display_name: string | null
  nav_ident: string | null
  deployment_count: number
}

export interface ReviewerEntry {
  github_username: string
  display_name: string | null
  review_count: number
}

export interface UnverifiedCommitEntry {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
  pr_number: number | null
  reason: string
}

export interface UnverifiedCommitDeploymentEntry {
  deployment_id: number
  date: string
  commit_sha: string
  title: string
  deployer: string
  deployer_display_name?: string
  four_eyes_status: string
  approved_by?: string
  approved_by_display_name?: string
  approved_at?: string
  commits: UnverifiedCommitEntry[]
}

interface AuditReportSummary {
  id: number
  report_id: string
  app_name: string
  team_slug: string
  environment_name: string
  year: number
  period_type: ReportPeriodType
  period_label: string
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  generated_at: Date
}

interface AuditReadinessCheck {
  is_ready: boolean
  total_deployments: number
  approved_count: number
  legacy_count: number
  pending_count: number
  pending_deployments: Array<{
    id: number
    created_at: Date
    commit_sha: string
    deployer_username: string
    four_eyes_status: string
  }>
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Check if all production deployments for an app in a period are approved
 */
export async function checkAuditReadiness(
  monitoredAppId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AuditReadinessCheck> {
  const startDate = periodStart
  const endDate = periodEnd

  // Get all deployments for the year in production environments
  const result = await pool.query<{
    id: number
    created_at: Date
    commit_sha: string
    deployer_username: string
    four_eyes_status: string
    environment_name: string
  }>(
    `SELECT d.id, d.created_at, d.commit_sha, d.deployer_username, d.four_eyes_status, ma.environment_name
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.monitored_app_id = $1
       AND d.created_at >= $2
       AND d.created_at <= $3
       AND ma.environment_name IN ('prod-fss', 'prod-gcp')
     ORDER BY d.created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )

  const deployments = result.rows
  // Approved statuses - 'approved' is the main status for PR-verified deployments
  const approvedStatuses = [
    'approved',
    'approved_pr',
    'manually_approved',
    'implicitly_approved',
    'legacy',
    'baseline',
    'no_changes',
  ]

  const approved = deployments.filter(
    (d) =>
      d.four_eyes_status === 'approved' ||
      d.four_eyes_status === 'approved_pr' ||
      d.four_eyes_status === 'manually_approved' ||
      d.four_eyes_status === 'implicitly_approved',
  )
  const legacy = deployments.filter((d) => d.four_eyes_status === 'legacy')
  const pending = deployments.filter((d) => !approvedStatuses.includes(d.four_eyes_status))

  return {
    is_ready: pending.length === 0 && deployments.length > 0,
    total_deployments: deployments.length,
    approved_count: approved.length,
    legacy_count: legacy.length,
    pending_count: pending.length,
    pending_deployments: pending.slice(0, 10), // Return first 10 for display
  }
}

/**
 * Get all data needed for an audit report
 */
export async function getAuditReportData(
  monitoredAppId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<{
  app: { app_name: string; team_slug: string; environment_name: string; test_requirement: string }
  repository: string
  deployments: AuditDeploymentRow[]
  manual_approvals: Array<{
    deployment_id: number
    comment_text: string
    slack_link: string
    approved_by: string
    approved_at: Date
  }>
  legacy_infos: Array<{
    deployment_id: number
    registered_by: string
  }>
  deviations: Awaited<ReturnType<typeof getDeviationsForPeriod>>
  reviewer_counts: Map<string, number>
  user_mappings: Map<string, { display_name: string | null; nav_ident: string | null; github_username: string }>
  canonical_map: Map<string, string>
}> {
  const startDate = periodStart
  const endDate = periodEnd

  // Get app info
  const appResult = await pool.query(
    `SELECT app_name, team_slug, environment_name, test_requirement FROM monitored_applications WHERE id = $1`,
    [monitoredAppId],
  )
  if (appResult.rows.length === 0) {
    throw new Error(`App not found: ${monitoredAppId}`)
  }
  const app = appResult.rows[0]

  // Get all production deployments for the year - extract approved_by from JSON in SQL
  // This avoids loading the large github_pr_data blob into memory
  const deploymentsResult = await pool.query<AuditDeploymentRow>(
    `SELECT 
       d.id,
       d.nais_deployment_id,
       d.title,
       d.created_at,
       d.commit_sha,
       d.deployer_username,
       d.four_eyes_status,
       d.github_pr_number,
       d.github_pr_url,
       d.detected_github_owner,
       d.detected_github_repo_name,
       ma.team_slug,
       ma.environment_name,
       ma.app_name,
       -- Extract all APPROVED reviewer usernames from JSON as array
       (
         SELECT jsonb_agg(r->>'username')
         FROM jsonb_array_elements(d.github_pr_data->'reviewers') AS r
         WHERE r->>'state' = 'APPROVED'
       ) AS approved_by_usernames,
       -- Extract PR creator/author from JSON
       d.github_pr_data->'creator'->>'username' AS pr_author,
       -- Include unverified commits JSONB for report appendix
       d.unverified_commits
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.monitored_app_id = $1
       AND d.created_at >= $2
       AND d.created_at <= $3
       AND ma.environment_name IN ('prod-fss', 'prod-gcp')
     ORDER BY d.created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )
  const deployments = deploymentsResult.rows

  // Determine repository from first deployment
  const repository =
    deployments.length > 0
      ? `${deployments[0].detected_github_owner}/${deployments[0].detected_github_repo_name}`
      : 'unknown'

  // Get manual approvals for these deployments
  const deploymentIds = deployments.map((d) => d.id)
  let manual_approvals: Array<{
    deployment_id: number
    comment_text: string
    slack_link: string
    approved_by: string
    approved_at: Date
  }> = []

  let legacy_infos: Array<{
    deployment_id: number
    registered_by: string
  }> = []

  // Aggregate reviewer counts directly in SQL to avoid loading github_pr_data
  const reviewer_counts = new Map<string, number>()

  if (deploymentIds.length > 0) {
    const approvalsResult = await pool.query(
      `SELECT deployment_id, comment_text, slack_link, approved_by, approved_at
       FROM deployment_comments
       WHERE deployment_id = ANY($1) AND comment_type = 'manual_approval'
       ORDER BY approved_at ASC`,
      [deploymentIds],
    )
    manual_approvals = approvalsResult.rows

    // Get legacy_info comments to find who registered legacy deployments
    const legacyInfoResult = await pool.query(
      `SELECT deployment_id, registered_by
       FROM deployment_comments
       WHERE deployment_id = ANY($1) AND comment_type = 'legacy_info'`,
      [deploymentIds],
    )
    legacy_infos = legacyInfoResult.rows

    // Get reviewer counts aggregated from github_pr_data in SQL
    const reviewerCountsResult = await pool.query<{ username: string; review_count: number }>(
      `SELECT 
         r->>'username' AS username,
         COUNT(*)::int AS review_count
       FROM deployments d,
       LATERAL jsonb_array_elements(d.github_pr_data->'reviewers') AS r
       WHERE d.id = ANY($1)
         AND r->>'state' = 'APPROVED'
       GROUP BY r->>'username'`,
      [deploymentIds],
    )
    for (const row of reviewerCountsResult.rows) {
      reviewer_counts.set(row.username, row.review_count)
    }
  }

  // Get user mappings for all deployers and reviewers
  // Collect all identifiers (could be github usernames or nav-idents)
  const identifiers = new Set<string>()
  for (const d of deployments) {
    if (d.deployer_username) identifiers.add(d.deployer_username)
    if (d.pr_author) identifiers.add(d.pr_author)
    if (d.approved_by_usernames) {
      for (const username of d.approved_by_usernames) {
        identifiers.add(username)
      }
    }
  }
  for (const a of manual_approvals) {
    if (a.approved_by) identifiers.add(a.approved_by)
  }
  for (const l of legacy_infos) {
    if (l.registered_by) identifiers.add(l.registered_by)
  }
  // Add reviewer usernames from aggregated counts
  for (const username of reviewer_counts.keys()) {
    identifiers.add(username)
  }

  // Fetch mappings where identifier matches github_username OR nav_ident
  const user_mappings = new Map<
    string,
    { display_name: string | null; nav_ident: string | null; github_username: string }
  >()
  // Maps any identifier (github_username or nav_ident) to canonical github_username
  const canonical_map = new Map<string, string>()

  if (identifiers.size > 0) {
    const identifierArray = Array.from(identifiers)
    const mappingsResult = await pool.query(
      `SELECT github_username, display_name, nav_ident 
       FROM user_mappings 
       WHERE github_username = ANY($1) OR nav_ident = ANY($1)`,
      [identifierArray],
    )
    for (const row of mappingsResult.rows) {
      user_mappings.set(row.github_username, {
        display_name: row.display_name,
        nav_ident: row.nav_ident,
        github_username: row.github_username,
      })
      // Map both github_username and nav_ident to the canonical github_username
      canonical_map.set(row.github_username, row.github_username)
      if (row.nav_ident) {
        canonical_map.set(row.nav_ident, row.github_username)
      }
    }
  }

  const deviations = await getDeviationsForPeriod(monitoredAppId, startDate, endDate)

  return {
    app,
    repository,
    deployments,
    manual_approvals,
    legacy_infos,
    reviewer_counts,
    user_mappings,
    canonical_map,
    deviations,
  }
}

/**
 * Build the structured report data from raw data
 */
export function buildReportData(rawData: Awaited<ReturnType<typeof getAuditReportData>>): AuditReportData {
  const {
    deployments,
    manual_approvals,
    legacy_infos,
    reviewer_counts,
    user_mappings,
    canonical_map,
    deviations: rawDeviations,
  } = rawData
  const manualApprovalMap = new Map(manual_approvals.map((a) => [a.deployment_id, a]))
  const legacyInfoMap = new Map(legacy_infos.map((l) => [l.deployment_id, l]))

  // Helper to get display name for any identifier (github username or nav-ident)
  const getDisplayName = (identifier: string | null | undefined): string | undefined => {
    if (!identifier) return undefined
    const canonical = canonical_map.get(identifier) || identifier
    return user_mappings.get(canonical)?.display_name || undefined
  }

  // Helper to get canonical username for aggregation
  const getCanonical = (identifier: string): string => {
    return canonical_map.get(identifier) || identifier
  }

  // Build deployments list
  const deploymentEntries: AuditDeploymentEntry[] = deployments.map((d) => {
    const isManual = d.four_eyes_status === 'manually_approved'
    const isLegacy = d.four_eyes_status === 'legacy'
    const manualApproval = manualApprovalMap.get(d.id)
    const legacyInfo = legacyInfoMap.get(d.id)
    // Treat as legacy if has legacy_info comment (even if status is manually_approved)
    const hasLegacyInfo = !!legacyInfo

    // Helper to format approvers list with display names
    const formatApprovers = (usernames: string[]): string => {
      return usernames.map((u) => getDisplayName(u) || u).join(', ')
    }

    // Find approver - now using extracted approved_by_usernames array from SQL
    let approver = ''
    if (isLegacy || hasLegacyInfo) {
      // Legacy: use GitHub PR reviewers if available, otherwise '-'
      approver = d.approved_by_usernames?.length ? formatApprovers(d.approved_by_usernames) : '-'
    } else if (isManual && manualApproval) {
      approver = getDisplayName(manualApproval.approved_by) || manualApproval.approved_by
    } else if (d.approved_by_usernames?.length) {
      approver = formatApprovers(d.approved_by_usernames)
    }

    // Determine method - use legacy if has legacy_info comment
    let method: 'pr' | 'manual' | 'legacy' = 'pr'
    if (isLegacy || hasLegacyInfo) {
      method = 'legacy'
    } else if (isManual) {
      method = 'manual'
    }

    return {
      id: d.id,
      nais_deployment_id: d.nais_deployment_id || '',
      title: d.title || '',
      date: d.created_at.toISOString(),
      commit_sha: d.commit_sha || '',
      method,
      pr_author: d.pr_author || undefined,
      pr_author_display_name: getDisplayName(d.pr_author),
      deployer: d.deployer_username || '',
      deployer_display_name: getDisplayName(d.deployer_username),
      approver,
      // Display name is already baked into approver string above
      approver_display_name: undefined,
      pr_number: d.github_pr_number || undefined,
      pr_url: d.github_pr_url || undefined,
      slack_link: manualApproval?.slack_link || undefined,
    }
  })

  // Build manual approvals list
  const manualApprovalEntries: ManualApprovalEntry[] = manual_approvals.map((a) => {
    const deployment = deployments.find((d) => d.id === a.deployment_id)
    const legacyInfo = legacyInfoMap.get(a.deployment_id)

    // Determine reason based on original status (before manually_approved)
    // Check if there's legacy_info - that means it was a legacy deployment
    let reason = 'Ekstra commits etter godkjenning'
    if (legacyInfo) {
      reason = 'Legacy deployment (GitHub-verifisert)'
    } else if (deployment?.four_eyes_status === 'direct_push') {
      reason = 'Direct push til main'
    }

    return {
      deployment_id: a.deployment_id,
      nais_deployment_id: deployment?.nais_deployment_id || '',
      title: deployment?.title || '',
      date: deployment?.created_at.toISOString() || '',
      commit_sha: deployment?.commit_sha || '',
      deployer: deployment?.deployer_username || '',
      deployer_display_name: getDisplayName(deployment?.deployer_username),
      reason,
      registered_by: legacyInfo?.registered_by || '',
      registered_by_display_name: getDisplayName(legacyInfo?.registered_by),
      approved_by: a.approved_by,
      approved_by_display_name: getDisplayName(a.approved_by),
      approved_at: a.approved_at.toISOString(),
      slack_link: a.slack_link,
      comment: a.comment_text,
    }
  })

  // Build contributors list - use canonical username for aggregation
  const contributorCounts = new Map<string, number>()
  for (const d of deployments) {
    if (d.deployer_username) {
      const canonical = getCanonical(d.deployer_username)
      contributorCounts.set(canonical, (contributorCounts.get(canonical) || 0) + 1)
    }
  }
  const contributors: ContributorEntry[] = Array.from(contributorCounts.entries())
    .map(([username, count]) => ({
      github_username: username,
      display_name: user_mappings.get(username)?.display_name || null,
      nav_ident: user_mappings.get(username)?.nav_ident || null,
      deployment_count: count,
    }))
    .sort((a, b) => b.deployment_count - a.deployment_count)

  // Build reviewers list - use canonical username for aggregation
  // Merge reviewers from PR reviews and manual approvals
  const combinedReviewerCounts = new Map<string, number>()
  // Add PR reviewers (use canonical)
  for (const [username, count] of reviewer_counts) {
    const canonical = getCanonical(username)
    combinedReviewerCounts.set(canonical, (combinedReviewerCounts.get(canonical) || 0) + count)
  }
  // Add manual approvers (use canonical)
  for (const a of manual_approvals) {
    if (a.approved_by) {
      const canonical = getCanonical(a.approved_by)
      combinedReviewerCounts.set(canonical, (combinedReviewerCounts.get(canonical) || 0) + 1)
    }
  }
  const reviewers: ReviewerEntry[] = Array.from(combinedReviewerCounts.entries())
    .map(([username, count]) => ({
      github_username: username,
      display_name: user_mappings.get(username)?.display_name || null,
      review_count: count,
    }))
    .sort((a, b) => b.review_count - a.review_count)

  // Count legacy deployments
  const legacyCount = deploymentEntries.filter((d) => d.method === 'legacy').length

  // Build deviations list
  const deviationEntries: DeviationEntry[] = rawDeviations.map((d) => {
    const deployment = deployments.find((dep) => dep.id === d.deployment_id)
    return {
      deployment_id: d.deployment_id,
      date: d.created_at.toISOString(),
      commit_sha: deployment?.commit_sha || '',
      reason: d.reason,
      breach_type: d.breach_type || null,
      intent: d.intent || null,
      severity: d.severity || null,
      follow_up_role: d.follow_up_role || null,
      registered_by: d.registered_by,
      registered_by_name: d.registered_by_name || getDisplayName(d.registered_by) || null,
      resolved_at: d.resolved_at?.toISOString() || null,
      resolution_note: d.resolution_note || null,
    }
  })

  // Build unverified commit deployments list
  // Include deployments that have unverified_commits data, regardless of current status
  // (they may have been manually approved since)
  const manualApprovalByDeployment = new Map(manual_approvals.map((a) => [a.deployment_id, a]))
  const unverifiedCommitDeployments: UnverifiedCommitDeploymentEntry[] = deployments
    .filter((d) => d.unverified_commits && d.unverified_commits.length > 0)
    .map((d) => {
      const manualApproval = manualApprovalByDeployment.get(d.id)
      const isManuallyApproved = d.four_eyes_status === 'manually_approved'

      return {
        deployment_id: d.id,
        date: d.created_at.toISOString(),
        commit_sha: d.commit_sha || '',
        title: d.title || '',
        deployer: d.deployer_username || '',
        deployer_display_name: getDisplayName(d.deployer_username),
        four_eyes_status: d.four_eyes_status,
        approved_by: isManuallyApproved && manualApproval ? manualApproval.approved_by : undefined,
        approved_by_display_name:
          isManuallyApproved && manualApproval ? getDisplayName(manualApproval.approved_by) : undefined,
        approved_at: isManuallyApproved && manualApproval ? manualApproval.approved_at.toISOString() : undefined,
        commits: d.unverified_commits ?? [],
      }
    })

  return {
    deployments: deploymentEntries,
    manual_approvals: manualApprovalEntries,
    contributors,
    reviewers,
    legacy_count: legacyCount,
    deviations: deviationEntries,
    unverified_commit_deployments: unverifiedCommitDeployments,
  }
}

/**
 * Calculate SHA256 hash of report data for integrity verification
 */
function calculateReportHash(reportData: AuditReportData): string {
  const json = JSON.stringify(reportData)
  return createHash('sha256').update(json).digest('hex')
}

/**
 * Save an audit report to the database
 */
export async function saveAuditReport(params: {
  monitoredAppId: number
  appName: string
  teamSlug: string
  environmentName: string
  repository: string
  year: number
  periodType: ReportPeriodType
  periodLabel: string
  periodStart: Date
  periodEnd: Date
  reportData: AuditReportData
  generatedBy?: string
}): Promise<AuditReport> {
  const {
    monitoredAppId,
    appName,
    teamSlug,
    environmentName,
    repository,
    year,
    periodType,
    periodLabel,
    periodStart,
    periodEnd,
    reportData,
    generatedBy,
  } = params

  const contentHash = calculateReportHash(reportData)
  const reportId = generateReportId(periodType, periodLabel, appName, environmentName, contentHash)

  const prApprovedCount = reportData.deployments.filter((d) => d.method === 'pr').length
  const manuallyApprovedCount = reportData.deployments.filter((d) => d.method === 'manual').length

  const result = await pool.query<AuditReport>(
    `INSERT INTO audit_reports (
      report_id, monitored_app_id, app_name, team_slug, environment_name, repository,
      year, period_type, period_label, period_start, period_end,
      total_deployments, pr_approved_count, manually_approved_count,
      unique_deployers, unique_reviewers,
      report_data, content_hash, generated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT (monitored_app_id, period_type, period_start) DO UPDATE SET
      report_id = EXCLUDED.report_id,
      app_name = EXCLUDED.app_name,
      team_slug = EXCLUDED.team_slug,
      environment_name = EXCLUDED.environment_name,
      repository = EXCLUDED.repository,
      period_label = EXCLUDED.period_label,
      period_end = EXCLUDED.period_end,
      total_deployments = EXCLUDED.total_deployments,
      pr_approved_count = EXCLUDED.pr_approved_count,
      manually_approved_count = EXCLUDED.manually_approved_count,
      unique_deployers = EXCLUDED.unique_deployers,
      unique_reviewers = EXCLUDED.unique_reviewers,
      report_data = EXCLUDED.report_data,
      content_hash = EXCLUDED.content_hash,
      generated_at = NOW(),
      generated_by = EXCLUDED.generated_by
    RETURNING *`,
    [
      reportId,
      monitoredAppId,
      appName,
      teamSlug,
      environmentName,
      repository,
      year,
      periodType,
      periodLabel,
      periodStart,
      periodEnd,
      reportData.deployments.length,
      prApprovedCount,
      manuallyApprovedCount,
      reportData.contributors.length,
      reportData.reviewers.length,
      JSON.stringify(reportData),
      contentHash,
      generatedBy || null,
    ],
  )

  return result.rows[0]
}

/**
 * Get an audit report by ID
 */
export async function getAuditReportById(id: number): Promise<AuditReport | null> {
  const result = await pool.query<AuditReport>('SELECT * FROM audit_reports WHERE id = $1', [id])
  return result.rows[0] || null
}

/**
 * Get all audit reports (summary)
 */
export async function getAllAuditReports(): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label,
            total_deployments, pr_approved_count, manually_approved_count, generated_at
     FROM audit_reports
     ORDER BY generated_at DESC`,
  )
  return result.rows
}

/**
 * Get audit reports for a specific app
 */
export async function getAuditReportsForApp(monitoredAppId: number): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label,
            total_deployments, pr_approved_count, manually_approved_count, generated_at
     FROM audit_reports
     WHERE monitored_app_id = $1
     ORDER BY year DESC, period_start DESC`,
    [monitoredAppId],
  )
  return result.rows
}

/**
 * Update PDF data for an audit report
 */
export async function updateAuditReportPdf(reportId: number, pdfData: Buffer): Promise<void> {
  await pool.query('UPDATE audit_reports SET pdf_data = $1 WHERE id = $2', [pdfData, reportId])
}
