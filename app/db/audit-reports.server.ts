import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { toDateString } from '~/lib/date-utils'
import { isDependabotUser } from '~/lib/dependabot'
import { isApprovedStatus } from '~/lib/four-eyes-status'
import type { ReportPeriodType } from '~/lib/report-periods'
import { generateReportId } from '~/lib/report-periods'
import { AUDIT_START_YEAR_FILTER } from './audit-start-year'
import { pool } from './connection.server'
import { getDeviationsForPeriod } from './deviations.server'
import { findDeploymentIdsMissingApprover } from './verification-diff.server'

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
  approved_by_usernames: string[] | null
  pr_author: string | null
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
  generated_at: Date
  generated_by: string | null
  generated_by_app: string | null
  change_origin_count: number | null
  superseded_at: Date | null
  superseded_by: string | null
  supersede_reason: string | null
  superseded_by_report_id: number | null
}

export interface AuditReportData {
  deployments: AuditDeploymentEntry[]
  manual_approvals: ManualApprovalEntry[]
  contributors: ContributorEntry[]
  reviewers: ReviewerEntry[]
  legacy_count: number
  baseline_count?: number
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

export interface AuditGoalLinkEntry {
  objective_title: string
  key_result_title: string | null
  team_name: string
  period_label: string
}

export interface AuditDeploymentEntry {
  id: number
  nais_deployment_id: string
  title: string
  date: string
  commit_sha: string
  method: 'pr' | 'manual' | 'legacy' | 'baseline'
  pr_author?: string
  pr_author_display_name?: string
  deployer: string
  deployer_display_name?: string
  approver: string
  approver_display_name?: string
  pr_number?: number
  pr_url?: string
  slack_link?: string
  goal_links?: AuditGoalLinkEntry[]
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

export interface AuditReportSummary {
  id: number
  report_id: string
  app_name: string
  team_slug: string
  environment_name: string
  year: number
  period_type: ReportPeriodType
  period_label: string
  period_start: Date
  period_end: Date
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  generated_at: Date
  archived_at: Date | null
  archived_by: string | null
  archive_reason: string | null
  superseded_at: Date | null
  superseded_by: string | null
  supersede_reason: string | null
  superseded_by_report_id: number | null
  formats: string[]
}

export interface AuditReadinessCheck {
  is_ready: boolean
  total_deployments: number
  approved_count: number
  legacy_count: number
  pending_count: number
  pending_deployments: Array<{
    id: number
    created_at: Date
    commit_sha: string | null
    deployer_username: string | null
    four_eyes_status: string
  }>
  missing_approver_count: number
  missing_approver_deployments: Array<{
    id: number
    created_at: Date
    commit_sha: string | null
    deployer_username: string | null
    four_eyes_status: string
  }>
}

export async function checkAuditReadiness(
  monitoredAppId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AuditReadinessCheck> {
  const startDate = periodStart
  const endDate = periodEnd

  const result = await pool.query<{
    id: number
    created_at: Date
    commit_sha: string | null
    deployer_username: string | null
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
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY d.created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )

  const deployments = result.rows

  const approved = deployments.filter((d) => isApprovedStatus(d.four_eyes_status))
  const legacy = deployments.filter((d) => d.four_eyes_status === 'legacy')
  const pending = deployments.filter((d) => !isApprovedStatus(d.four_eyes_status) && d.four_eyes_status !== 'legacy')

  const approvedIds = approved.map((d) => d.id)
  let missingApprover: typeof approved = []

  if (approvedIds.length > 0) {
    const missingIds = await findDeploymentIdsMissingApprover(approvedIds)
    missingApprover = approved.filter((d) => missingIds.has(d.id))
  }

  return {
    is_ready: pending.length === 0 && missingApprover.length === 0 && deployments.length > 0,
    total_deployments: deployments.length,
    approved_count: approved.length,
    legacy_count: legacy.length,
    pending_count: pending.length,
    pending_deployments: pending.slice(0, 10),
    missing_approver_count: missingApprover.length,
    missing_approver_deployments: missingApprover.slice(0, 10),
  }
}

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
  baseline_approvals: Array<{
    deployment_id: number
    changed_by: string | null
    created_at: Date
  }>
  deviations: Awaited<ReturnType<typeof getDeviationsForPeriod>>
  reviewer_counts: Map<string, number>
  user_mappings: Map<string, { display_name: string | null; nav_ident: string | null; github_username: string }>
  canonical_map: Map<string, string>
  goal_links_by_deployment: Map<number, AuditGoalLinkEntry[]>
}> {
  const startDate = periodStart
  const endDate = periodEnd

  const appResult = await pool.query(
    `SELECT app_name, team_slug, environment_name, test_requirement FROM monitored_applications WHERE id = $1`,
    [monitoredAppId],
  )
  if (appResult.rows.length === 0) {
    throw new Error(`App not found: ${monitoredAppId}`)
  }
  const app = appResult.rows[0]

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
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY d.created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )
  const deployments = deploymentsResult.rows

  const repository =
    deployments.length > 0
      ? `${deployments[0].detected_github_owner}/${deployments[0].detected_github_repo_name}`
      : 'unknown'

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

  let baseline_approvals: Array<{
    deployment_id: number
    changed_by: string | null
    created_at: Date
  }> = []

  const reviewer_counts = new Map<string, number>()

  if (deploymentIds.length > 0) {
    const approvalsResult = await pool.query(
      `SELECT deployment_id, comment_text, slack_link, approved_by, approved_at
       FROM deployment_comments
       WHERE deployment_id = ANY($1) AND comment_type = 'manual_approval' AND deleted_at IS NULL
       ORDER BY approved_at ASC`,
      [deploymentIds],
    )
    manual_approvals = approvalsResult.rows

    const legacyInfoResult = await pool.query(
      `SELECT deployment_id, registered_by
       FROM deployment_comments
       WHERE deployment_id = ANY($1) AND comment_type = 'legacy_info' AND deleted_at IS NULL`,
      [deploymentIds],
    )
    legacy_infos = legacyInfoResult.rows

    const baselineApprovalResult = await pool.query<{
      deployment_id: number
      changed_by: string | null
      created_at: Date
    }>(
      `SELECT deployment_id, changed_by, created_at
       FROM deployment_status_history
       WHERE deployment_id = ANY($1) AND change_source = 'baseline_approval'
       ORDER BY created_at ASC`,
      [deploymentIds],
    )
    baseline_approvals = baselineApprovalResult.rows

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
  for (const b of baseline_approvals) {
    if (b.changed_by) identifiers.add(b.changed_by)
  }
  for (const username of reviewer_counts.keys()) {
    identifiers.add(username)
  }

  const userLookups = new Map<
    string,
    { display_name: string | null; nav_ident: string | null; github_username: string }
  >()
  const canonical_map = new Map<string, string>()

  if (identifiers.size > 0) {
    const identifierArray = Array.from(identifiers)
    const mappingsResult = await pool.query(
      `SELECT uga.github_username,
              u.display_name,
              uga.nav_ident
       FROM user_github_accounts uga
       LEFT JOIN users u ON u.nav_ident = uga.nav_ident AND u.deleted_at IS NULL
       WHERE uga.github_username = ANY($1) OR uga.nav_ident = ANY($2)`,
      [identifierArray.map((id) => id.toLowerCase()), identifierArray.map((id) => id.toUpperCase())],
    )
    for (const row of mappingsResult.rows) {
      userLookups.set(row.github_username, {
        display_name: row.display_name,
        nav_ident: row.nav_ident,
        github_username: row.github_username,
      })
      canonical_map.set(row.github_username, row.github_username)
      if (row.nav_ident) {
        canonical_map.set(row.nav_ident, row.github_username)
      }
    }
    const githubSet = new Set(mappingsResult.rows.map((r) => r.github_username))
    const navIdentMap = new Map<string, string>(
      mappingsResult.rows.filter((r) => r.nav_ident).map((r) => [r.nav_ident, r.github_username]),
    )
    for (const original of identifierArray) {
      const byGithub = githubSet.has(original.toLowerCase()) ? original.toLowerCase() : undefined
      if (byGithub) canonical_map.set(original, byGithub)
      const byNavIdent = navIdentMap.get(original.toUpperCase())
      if (byNavIdent) canonical_map.set(original, byNavIdent)
    }
  }

  const deviations = await getDeviationsForPeriod(monitoredAppId, startDate, endDate)

  const goal_links_by_deployment = new Map<
    number,
    Array<{ objective_title: string; key_result_title: string | null; team_name: string; period_label: string }>
  >()
  if (deploymentIds.length > 0) {
    const goalLinksResult = await pool.query<{
      deployment_id: number
      objective_title: string | null
      key_result_title: string | null
      team_name: string | null
      period_label: string | null
    }>(
      `SELECT dgl.deployment_id,
              COALESCE(bo.title, bo_via_kr.title) AS objective_title,
              bkr.title AS key_result_title,
              dt.name AS team_name,
              COALESCE(b.period_label, b_via_kr.period_label) AS period_label
       FROM deployment_goal_links dgl
       LEFT JOIN board_objectives bo ON bo.id = dgl.objective_id
       LEFT JOIN board_key_results bkr ON bkr.id = dgl.key_result_id
       LEFT JOIN board_objectives bo_via_kr ON bo_via_kr.id = bkr.objective_id
       LEFT JOIN boards b ON b.id = bo.board_id
       LEFT JOIN boards b_via_kr ON b_via_kr.id = bo_via_kr.board_id
       LEFT JOIN dev_teams dt ON dt.id = COALESCE(b.dev_team_id, b_via_kr.dev_team_id)
       WHERE dgl.deployment_id = ANY($1)
         AND dgl.is_active = true
         AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
       ORDER BY dgl.deployment_id, dgl.created_at ASC`,
      [deploymentIds],
    )
    for (const row of goalLinksResult.rows) {
      if (!row.objective_title || !row.team_name || !row.period_label) {
        continue
      }
      if (!goal_links_by_deployment.has(row.deployment_id)) {
        goal_links_by_deployment.set(row.deployment_id, [])
      }
      goal_links_by_deployment.get(row.deployment_id)?.push({
        objective_title: row.objective_title,
        key_result_title: row.key_result_title,
        team_name: row.team_name,
        period_label: row.period_label,
      })
    }
  }

  return {
    app,
    repository,
    deployments,
    manual_approvals,
    legacy_infos,
    baseline_approvals,
    reviewer_counts,
    user_mappings: userLookups,
    canonical_map,
    deviations,
    goal_links_by_deployment,
  }
}

export function buildReportData(rawData: Awaited<ReturnType<typeof getAuditReportData>>): AuditReportData {
  const {
    deployments,
    manual_approvals,
    legacy_infos,
    baseline_approvals,
    reviewer_counts,
    user_mappings: userLookups,
    canonical_map,
    deviations: rawDeviations,
    goal_links_by_deployment,
  } = rawData
  const manualApprovalMap = new Map(manual_approvals.map((a) => [a.deployment_id, a]))
  const legacyInfoMap = new Map(legacy_infos.map((l) => [l.deployment_id, l]))
  const baselineApprovalMap = new Map(baseline_approvals.map((b) => [b.deployment_id, b]))

  const getDisplayName = (identifier: string | null | undefined): string | undefined => {
    if (!identifier) return undefined
    const canonical = canonical_map.get(identifier) || identifier
    return userLookups.get(canonical)?.display_name || undefined
  }

  const getCanonical = (identifier: string): string => {
    return canonical_map.get(identifier) || identifier
  }

  const deploymentEntries: AuditDeploymentEntry[] = deployments.map((d) => {
    const isManual = d.four_eyes_status === 'manually_approved'
    const isLegacy = d.four_eyes_status === 'legacy'
    const isBaseline = d.four_eyes_status === 'baseline'
    const manualApproval = manualApprovalMap.get(d.id)
    const legacyInfo = legacyInfoMap.get(d.id)
    const baselineApproval = baselineApprovalMap.get(d.id)
    const hasLegacyInfo = !!legacyInfo

    const formatApprovers = (usernames: string[]): string => {
      return usernames.map((u) => getDisplayName(u) || u).join(', ')
    }

    let approver = ''
    if (isLegacy || hasLegacyInfo) {
      approver = d.approved_by_usernames?.length ? formatApprovers(d.approved_by_usernames) : '-'
    } else if (isBaseline) {
      if (!baselineApproval?.changed_by) {
        throw new Error(
          `Baseline deployment ${d.id} is missing an approver in deployment_status_history. ` +
            `Cannot generate audit report with unattributed baseline approval.`,
        )
      }
      approver = getDisplayName(baselineApproval.changed_by) || baselineApproval.changed_by
    } else if (isManual && manualApproval) {
      approver = getDisplayName(manualApproval.approved_by) || manualApproval.approved_by
    } else if (d.approved_by_usernames?.length) {
      approver = formatApprovers(d.approved_by_usernames)
    }

    let method: 'pr' | 'manual' | 'legacy' | 'baseline' = 'pr'
    if (isLegacy || hasLegacyInfo) {
      method = 'legacy'
    } else if (isBaseline) {
      method = 'baseline'
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
      approver_display_name: undefined,
      pr_number: d.github_pr_number || undefined,
      pr_url: d.github_pr_url || undefined,
      slack_link: manualApproval?.slack_link || undefined,
      goal_links: goal_links_by_deployment.get(d.id) || undefined,
    }
  })

  const manualApprovalEntries: ManualApprovalEntry[] = manual_approvals.map((a) => {
    const deployment = deployments.find((d) => d.id === a.deployment_id)
    const legacyInfo = legacyInfoMap.get(a.deployment_id)

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
      display_name: userLookups.get(username)?.display_name || null,
      nav_ident: userLookups.get(username)?.nav_ident || null,
      deployment_count: count,
    }))
    .sort((a, b) => b.deployment_count - a.deployment_count)

  const combinedReviewerCounts = new Map<string, number>()
  for (const [username, count] of reviewer_counts) {
    const canonical = getCanonical(username)
    combinedReviewerCounts.set(canonical, (combinedReviewerCounts.get(canonical) || 0) + count)
  }
  for (const a of manual_approvals) {
    if (a.approved_by) {
      const canonical = getCanonical(a.approved_by)
      combinedReviewerCounts.set(canonical, (combinedReviewerCounts.get(canonical) || 0) + 1)
    }
  }
  const reviewers: ReviewerEntry[] = Array.from(combinedReviewerCounts.entries())
    .map(([username, count]) => ({
      github_username: username,
      display_name: userLookups.get(username)?.display_name || null,
      review_count: count,
    }))
    .sort((a, b) => b.review_count - a.review_count)

  const legacyCount = deploymentEntries.filter((d) => d.method === 'legacy').length
  const baselineCount = deploymentEntries.filter((d) => d.method === 'baseline').length

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
    baseline_count: baselineCount,
    deviations: deviationEntries,
    unverified_commit_deployments: unverifiedCommitDeployments,
  }
}

function calculateReportHash(reportData: AuditReportData): string {
  const json = JSON.stringify(reportData)
  return createHash('sha256').update(json).digest('hex')
}

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
  generatedByApp?: string
  supersedeReason?: string
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
    generatedByApp,
    supersedeReason,
  } = params

  const contentHash = calculateReportHash(reportData)
  const reportId = generateReportId(periodType, periodLabel, appName, environmentName, contentHash)

  const prApprovedCount = reportData.deployments.filter((d) => d.method === 'pr').length
  const manuallyApprovedCount = reportData.deployments.filter((d) => d.method === 'manual').length

  const changeOriginCount = reportData.deployments.filter(
    (d) => d.goal_links && d.goal_links.length > 0 && !isDependabotUser(d.pr_author),
  ).length

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const supersededIds = await supersedeExistingReports(
      client,
      monitoredAppId,
      periodType,
      periodStart,
      periodEnd,
      generatedBy ?? generatedByApp,
      supersedeReason,
    )

    if (supersededIds.length > 0 && !supersedeReason) {
      throw new Error('An active report already exists for this period. You must provide a reason to supersede it.')
    }

    const result = await client.query<AuditReport>(
      `INSERT INTO audit_reports (
        report_id, monitored_app_id, app_name, team_slug, environment_name, repository,
        year, period_type, period_label, period_start, period_end,
        total_deployments, pr_approved_count, manually_approved_count,
        unique_deployers, unique_reviewers,
        report_data, content_hash, generated_by, generated_by_app, change_origin_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
        toDateString(periodStart),
        toDateString(periodEnd),
        reportData.deployments.length,
        prApprovedCount,
        manuallyApprovedCount,
        reportData.contributors.length,
        reportData.reviewers.length,
        JSON.stringify(reportData),
        contentHash,
        generatedBy || null,
        generatedByApp || null,
        changeOriginCount,
      ],
    )

    const newReport = result.rows[0]

    if (supersededIds.length > 0) {
      await client.query(`UPDATE audit_reports SET superseded_by_report_id = $1 WHERE id = ANY($2)`, [
        newReport.id,
        supersededIds,
      ])
    }

    await client.query('COMMIT')
    return newReport
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getAuditReportById(id: number): Promise<AuditReport | null> {
  const result = await pool.query<AuditReport>('SELECT * FROM audit_reports WHERE id = $1', [id])
  return result.rows[0] || null
}

export async function getAllAuditReports(): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label, period_start, period_end,
            total_deployments, pr_approved_count, manually_approved_count, generated_at,
            archived_at, archived_by, archive_reason,
            superseded_at, superseded_by, supersede_reason, superseded_by_report_id,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     ORDER BY generated_at DESC`,
  )
  return result.rows
}

export async function getAuditReportsForApp(monitoredAppId: number): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label, period_start, period_end,
            total_deployments, pr_approved_count, manually_approved_count, generated_at,
            archived_at, archived_by, archive_reason,
            superseded_at, superseded_by, supersede_reason, superseded_by_report_id,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1 AND archived_at IS NULL AND superseded_at IS NULL
     ORDER BY year DESC, period_start DESC`,
    [monitoredAppId],
  )
  return result.rows
}

export async function getAuditReportsForAppAdmin(monitoredAppId: number): Promise<AuditReportSummary[]> {
  const result = await pool.query<AuditReportSummary>(
    `SELECT id, report_id, app_name, team_slug, environment_name, year, period_type, period_label, period_start, period_end,
            total_deployments, pr_approved_count, manually_approved_count, generated_at,
            archived_at, archived_by, archive_reason,
            superseded_at, superseded_by, supersede_reason, superseded_by_report_id,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1
     ORDER BY year DESC, period_start DESC`,
    [monitoredAppId],
  )
  return result.rows
}

export async function saveAuditReportFile(reportId: number, format: 'pdf' | 'xlsx', data: Buffer): Promise<void> {
  await pool.query(
    `INSERT INTO audit_report_files (audit_report_id, format, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (audit_report_id, format) DO UPDATE SET data = EXCLUDED.data`,
    [reportId, format, data],
  )
}

export async function getAuditReportFile(reportId: number, format: 'pdf' | 'xlsx'): Promise<Buffer | null> {
  const result = await pool.query<{ data: Buffer }>(
    'SELECT data FROM audit_report_files WHERE audit_report_id = $1 AND format = $2',
    [reportId, format],
  )
  return result.rows[0]?.data ?? null
}

export async function archiveAuditReport(
  id: number,
  monitoredAppId: number,
  archivedBy: string,
  reason: string,
): Promise<boolean> {
  const result = await pool.query(
    'UPDATE audit_reports SET archived_at = NOW(), archived_by = $1, archive_reason = $2 WHERE id = $3 AND monitored_app_id = $4 AND archived_at IS NULL',
    [archivedBy, reason, id, monitoredAppId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function restoreAuditReport(id: number, monitoredAppId: number, restoredBy: string): Promise<boolean> {
  const result = await pool.query(
    'UPDATE audit_reports SET archived_at = NULL, restored_at = NOW(), restored_by = $1 WHERE id = $2 AND monitored_app_id = $3 AND archived_at IS NOT NULL',
    [restoredBy, id, monitoredAppId],
  )
  return (result.rowCount ?? 0) > 0
}

async function supersedeExistingReports(
  client: PoolClient,
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
  periodEnd: Date,
  supersededBy?: string,
  supersedeReason?: string,
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `UPDATE audit_reports
     SET superseded_at = NOW(),
         superseded_by = $1,
         supersede_reason = $2
     WHERE monitored_app_id = $3
       AND period_type = $4
       AND period_start = $5::date
       AND period_end = $6::date
       AND superseded_at IS NULL
       AND archived_at IS NULL
     RETURNING id`,
    [
      supersededBy || null,
      supersedeReason || null,
      monitoredAppId,
      periodType,
      toDateString(periodStart),
      toDateString(periodEnd),
    ],
  )
  return result.rows.map((r) => r.id)
}

export async function hasActiveReportForPeriod(
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
  periodEnd: Date,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM audit_reports
     WHERE monitored_app_id = $1
       AND period_type = $2
       AND period_start = $3::date
       AND period_end = $4::date
       AND superseded_at IS NULL
       AND archived_at IS NULL
     LIMIT 1`,
    [monitoredAppId, periodType, toDateString(periodStart), toDateString(periodEnd)],
  )
  return result.rows.length > 0
}

interface M2MAuditReportRow {
  id: number
  report_id: string
  period_type: ReportPeriodType
  period_label: string
  period_start: Date
  period_end: Date
  generated_at: Date
  generated_by: string | null
  generated_by_app: string | null
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  change_origin_count: number | null
  content_hash: string
  formats: string[]
}

export async function getActiveReportsForAppM2M(monitoredAppId: number): Promise<M2MAuditReportRow[]> {
  const result = await pool.query<M2MAuditReportRow>(
    `SELECT id, report_id, period_type, period_label, period_start, period_end,
            generated_at, generated_by, generated_by_app,
            total_deployments, pr_approved_count, manually_approved_count,
            change_origin_count, content_hash,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1 AND archived_at IS NULL AND superseded_at IS NULL
       AND EXISTS (SELECT 1 FROM audit_report_files arf WHERE arf.audit_report_id = audit_reports.id AND arf.format = 'pdf')
     ORDER BY period_start DESC`,
    [monitoredAppId],
  )
  return result.rows
}

export async function getActiveReportsForPeriodM2M(
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
): Promise<M2MAuditReportRow[]> {
  const result = await pool.query<M2MAuditReportRow>(
    `SELECT id, report_id, period_type, period_label, period_start, period_end,
            generated_at, generated_by, generated_by_app,
            total_deployments, pr_approved_count, manually_approved_count,
            change_origin_count, content_hash,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE monitored_app_id = $1
       AND period_type = $2
       AND period_start = $3::date
       AND archived_at IS NULL AND superseded_at IS NULL
       AND EXISTS (SELECT 1 FROM audit_report_files arf WHERE arf.audit_report_id = audit_reports.id AND arf.format = 'pdf')
     ORDER BY generated_at DESC`,
    [monitoredAppId, periodType, toDateString(periodStart)],
  )
  return result.rows
}

export async function getReportByReportIdForApp(
  reportId: string,
  monitoredAppId: number,
): Promise<{ id: number; report_id: string; archived_at: Date | null } | null> {
  const result = await pool.query(
    `SELECT id, report_id, archived_at
     FROM audit_reports
     WHERE report_id = $1 AND monitored_app_id = $2`,
    [reportId, monitoredAppId],
  )
  return result.rows[0] || null
}

export async function getReportSummaryById(reportId: number): Promise<M2MAuditReportRow | null> {
  const result = await pool.query<M2MAuditReportRow>(
    `SELECT id, report_id, period_type, period_label, period_start, period_end,
            generated_at, generated_by, generated_by_app,
            total_deployments, pr_approved_count, manually_approved_count,
            change_origin_count, content_hash,
            ARRAY(SELECT format FROM audit_report_files WHERE audit_report_id = audit_reports.id ORDER BY format) AS formats
     FROM audit_reports
     WHERE id = $1`,
    [reportId],
  )
  return result.rows[0] || null
}
