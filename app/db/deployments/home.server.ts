import { APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'
import { isGitHubBot, NON_BRACKET_BOT_USERNAMES } from '~/lib/github-bots'
import { baselineActionSql } from '../baseline-action'
import { pool } from '../connection.server'
import type { AppWithIssues, DeploymentWithApp } from '../deployments.server'
import { getDevTeamApplications, getGroupAppIdsForDevTeams } from '../dev-teams.server'
import { getMembersGithubUsernamesForDevTeamRoles } from '../role-assignments.server'
import { lowerUsernames, userDeploymentMatchAnySql, userDeploymentMatchSql } from '../user-deployment-match'

interface DevTeamScope {
  naisTeamSlugs: string[]
  directAppIds: number[] | undefined
  deployerUsernames: string[] | undefined
  noMembersMapped: boolean
}

export async function resolveDevTeamScope(
  devTeams: { id: number; nais_team_slugs: string[] }[],
): Promise<DevTeamScope> {
  const naisTeamSlugs = [...new Set(devTeams.flatMap((t) => t.nais_team_slugs))]
  const devTeamIds = devTeams.map((t) => t.id)

  const [directAppsResults, groupAppIds] = await Promise.all([
    Promise.all(devTeams.map((t) => getDevTeamApplications(t.id))),
    getGroupAppIdsForDevTeams(devTeamIds),
  ])
  const allDirectAppIds = [...new Set([...directAppsResults.flat().map((a) => a.monitored_app_id), ...groupAppIds])]
  const directAppIds = allDirectAppIds.length > 0 ? allDirectAppIds : undefined

  let deployerUsernames: string[] | undefined
  try {
    deployerUsernames = await getMembersGithubUsernamesForDevTeamRoles(devTeamIds)
  } catch {
    deployerUsernames = undefined
  }

  const noMembersMapped = deployerUsernames !== undefined && deployerUsernames.length === 0

  return { naisTeamSlugs, directAppIds, deployerUsernames, noMembersMapped }
}

export async function getUnmappedContributors(
  naisTeamSlugs: string[],
  directAppIds?: number[],
  since?: Date,
): Promise<string[]> {
  const ids = directAppIds ?? []
  const sinceDate = since ?? new Date(new Date().getFullYear(), 0, 1)
  const result = await pool.query<{ username: string }>(
    `WITH team_deployers AS (
       SELECT LOWER(d.deployer_username) AS username
       FROM deployments d
       JOIN monitored_applications ma ON d.monitored_app_id = ma.id
       WHERE ma.is_active = true
         AND (ma.team_slug = ANY($1::text[]) OR ma.id = ANY($2::int[]))
         AND d.deployer_username IS NOT NULL
         AND d.deployer_username != ''
         AND d.created_at >= $3
         AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
       GROUP BY LOWER(d.deployer_username)
     ),
     mapped_usernames AS (
       SELECT DISTINCT LOWER(uga.github_username) AS username
       FROM user_github_accounts uga
       WHERE uga.deleted_at IS NULL
     )
     SELECT td.username
     FROM team_deployers td
     LEFT JOIN mapped_usernames mu ON mu.username = td.username
     WHERE mu.username IS NULL
     ORDER BY td.username`,
    [naisTeamSlugs, ids, sinceDate],
  )
  return result.rows.map((r) => r.username).filter((u) => !isGitHubBot(u))
}

export async function getDevTeamAppsWithIssues(
  naisTeamSlugs: string[],
  directAppIds?: number[],
  deployerUsernames?: string[],
): Promise<AppWithIssues[]> {
  const ids = directAppIds ?? []

  const hasDeployerFilter = deployerUsernames !== undefined
  const deployerFilterClause = hasDeployerFilter ? ` AND ${userDeploymentMatchAnySql(6, 'd')}` : ''
  const params: unknown[] = [APPROVED_STATUSES, PENDING_STATUSES, naisTeamSlugs, ids, NON_BRACKET_BOT_USERNAMES]
  if (hasDeployerFilter) params.push(lowerUsernames(deployerUsernames))

  const result = await pool.query(
    `
    WITH mapped_users AS (
      SELECT DISTINCT LOWER(github_username) AS username
     FROM user_github_accounts
      WHERE deleted_at IS NULL
    )
    SELECT 
      ma.app_name,
      ma.team_slug,
      ma.environment_name,
      GREATEST(0, COALESCE(dep.total_count, 0) - COALESCE(dep.with_four_eyes, 0) - COALESCE(dep.pending_verification, 0))::integer as without_four_eyes,
      COALESCE(dep.pending_verification, 0)::integer as pending_verification,
      COALESCE(alerts.count, 0)::integer as alert_count,
      COALESCE(dep.missing_goal_links, 0)::integer as missing_goal_links,
      COALESCE(dep.unmapped_deployer_count, 0)::integer as unmapped_deployer_count,
      COALESCE(dep.baseline_action_count, 0)::integer as baseline_action_count
    FROM monitored_applications ma
    LEFT JOIN LATERAL (
      SELECT 
        SUM(CASE WHEN true${deployerFilterClause} THEN 1 ELSE 0 END) as total_count,
        SUM(CASE WHEN COALESCE(d.four_eyes_status, 'unknown') = ANY($1)${deployerFilterClause} THEN 1 ELSE 0 END) as with_four_eyes,
        SUM(CASE WHEN COALESCE(d.four_eyes_status, 'unknown') = ANY($2)${deployerFilterClause} THEN 1 ELSE 0 END) as pending_verification,
        SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM deployment_goal_links dgl WHERE dgl.deployment_id = d.id AND dgl.is_active = true AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL))${deployerFilterClause} THEN 1 ELSE 0 END) as missing_goal_links,
        COUNT(DISTINCT CASE
          WHEN d.deployer_username IS NOT NULL
            AND d.deployer_username != ''
            AND d.deployer_username NOT LIKE '%[bot]'
            AND LOWER(d.deployer_username) != ALL($5::text[])
            AND NOT EXISTS (
              SELECT 1 FROM mapped_users mu
              WHERE mu.username = LOWER(d.deployer_username)
            )
          THEN LOWER(d.deployer_username)
        END) as unmapped_deployer_count,
        SUM(CASE WHEN ${baselineActionSql('d')} THEN 1 ELSE 0 END) as baseline_action_count
      FROM deployments d
      WHERE d.monitored_app_id = ma.id
        AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
    ) dep ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as count
      FROM repository_alerts ra
      WHERE ra.monitored_app_id = ma.id AND ra.resolved_at IS NULL
    ) alerts ON true
    WHERE ma.is_active = true
      AND (ma.team_slug = ANY($3::text[]) OR ma.id = ANY($4::int[]))
      AND (GREATEST(0, COALESCE(dep.total_count, 0) - COALESCE(dep.with_four_eyes, 0) - COALESCE(dep.pending_verification, 0)) > 0 
        OR COALESCE(dep.pending_verification, 0) > 0 
        OR COALESCE(alerts.count, 0) > 0
        OR COALESCE(dep.missing_goal_links, 0) > 0
        OR COALESCE(dep.unmapped_deployer_count, 0) > 0
        OR COALESCE(dep.baseline_action_count, 0) > 0)
    ORDER BY GREATEST(0, COALESCE(dep.total_count, 0) - COALESCE(dep.with_four_eyes, 0) - COALESCE(dep.pending_verification, 0)) DESC, COALESCE(dep.missing_goal_links, 0) DESC, COALESCE(alerts.count, 0) DESC
  `,
    params,
  )
  return result.rows
}

async function _getRecentDeploymentsForHomeTab(limit = 10): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT d.*, 
            ma.team_slug, ma.environment_name, ma.app_name
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE ma.is_active = true
     ORDER BY d.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

export async function getPersonalDeploymentsMissingGoalLinks(githubUsername: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::integer AS count
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE ma.is_active = true
       AND (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1))
       AND ${userDeploymentMatchSql(1)}
       AND NOT EXISTS (
         SELECT 1 FROM deployment_goal_links dgl
         WHERE dgl.deployment_id = d.id AND dgl.is_active = true
           AND (dgl.objective_id IS NOT NULL OR dgl.key_result_id IS NOT NULL)
       )`,
    [githubUsername],
  )
  return result.rows[0]?.count ?? 0
}
