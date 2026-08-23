import { LEGACY_STATUSES_SQL } from '~/lib/four-eyes-status'
import { AUDIT_START_YEAR_FILTER } from '../../audit-start-year'
import { pool } from '../../connection.server'
import { getDeviationsForPeriod } from '../../deviations.server'
import type { AuditDeploymentRow, AuditGoalLinkEntry } from './types'

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
  admin_resets: Array<{
    deployment_id: number
    changed_by: string | null
    created_at: Date
    details: { reason?: string } | null
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
       d.unverified_commits,
       -- Commit SHAs bundled in this delivery, from the cached GitHub compare snapshot
       (
         SELECT ARRAY(SELECT jsonb_array_elements(cmp.data->'commits')->>'sha')
         FROM github_compare_snapshots cmp
         WHERE cmp.owner = d.detected_github_owner
           AND cmp.repo = d.detected_github_repo_name
           AND cmp.head_sha = d.commit_sha
           AND cmp.base_sha = (
             SELECT prev.commit_sha
             FROM deployments prev
             WHERE prev.monitored_app_id = d.monitored_app_id
               AND prev.environment_name = ma.environment_name
               AND prev.created_at < d.created_at
               AND prev.commit_sha IS NOT NULL
               AND prev.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
               AND prev.commit_sha !~ '^refs/'
             ORDER BY prev.created_at DESC
             LIMIT 1
           )
         ORDER BY cmp.fetched_at DESC
         LIMIT 1
       ) AS delivery_commit_shas,
       -- Commit SHAs belonging to this deployment's PR, if any
       (
         SELECT ARRAY(SELECT jsonb_array_elements(pr.data)->>'sha')
         FROM github_pr_snapshots pr
         WHERE pr.owner = d.detected_github_owner
           AND pr.repo = d.detected_github_repo_name
           AND pr.pr_number = d.github_pr_number
           AND pr.data_type = 'commits'
         ORDER BY pr.fetched_at DESC
         LIMIT 1
       ) AS pr_commit_shas
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

  let admin_resets: Array<{
    deployment_id: number
    changed_by: string | null
    created_at: Date
    details: { reason?: string } | null
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

  const adminResetsResult = await pool.query<{
    deployment_id: number
    changed_by: string | null
    created_at: Date
    details: { reason?: string } | null
  }>(
    `SELECT dsh.deployment_id, dsh.changed_by, dsh.created_at, dsh.details
     FROM deployment_status_history dsh
     JOIN deployments d ON d.id = dsh.deployment_id
     WHERE d.monitored_app_id = $1
       AND dsh.change_source = 'admin_reset'
       AND dsh.created_at >= $2 AND dsh.created_at <= $3
     ORDER BY dsh.created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )
  admin_resets = adminResetsResult.rows

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
  for (const r of admin_resets) {
    if (r.changed_by) identifiers.add(r.changed_by)
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
    admin_resets,
    reviewer_counts,
    user_mappings: userLookups,
    canonical_map,
    deviations,
    goal_links_by_deployment,
  }
}
