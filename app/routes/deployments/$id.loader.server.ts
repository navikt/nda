import type { AvailableBoard } from '~/components/GoalLinksSection'
import { getRepositoriesByAppId } from '~/db/application-repositories.server'
import { getBoardsWithGoalsForDevTeam } from '~/db/boards.server'
import { getCommentsByDeploymentId, getLegacyInfo, getManualApproval } from '~/db/comments.server'
import { pool } from '~/db/connection.server'
import { getLinksForDeployment } from '~/db/deployment-goal-links.server'
import {
  type DeploymentNavFilters,
  getDeploymentById,
  getNextDeployment,
  getPreviousDeploymentForDiff,
  getPreviousDeploymentForNav,
  getStatusHistory,
  TITLE_COALESCE_SQL,
} from '~/db/deployments.server'
import { getDevTeamsBySection, getDevTeamsForApp } from '~/db/dev-teams.server'
import { getDeviationsByDeploymentId } from '~/db/deviations.server'
import { getLatestVerificationRun } from '~/db/github-data.server'
import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import { getUserDevTeamsByRole } from '~/db/role-assignments.server'
import { getUsersByIdentifiers } from '~/db/user-github-lookups.server'
import { getUserIdentity } from '~/lib/auth.server'
import { type DeploymentCapabilities, resolveDeploymentCapabilities } from '~/lib/authorization.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import { serializeUserLookups } from '~/lib/user-display'
import { isVerificationDebugMode } from '~/lib/verification'
import type { Route } from './+types/$id'

export async function loader({ params, request }: Route.LoaderArgs) {
  const deploymentId = parseInt(params.id, 10)
  const deployment = await getDeploymentById(deploymentId)

  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 })
  }

  const app = await getMonitoredApplicationById(deployment.monitored_app_id)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }
  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  const url = new URL(request.url)
  if (url.pathname === `/deployments/${deploymentId}`) {
    const searchParams = url.searchParams.toString()
    const redirectUrl = `${appUrl}/deployments/${deploymentId}${searchParams ? `?${searchParams}` : ''}`
    return Response.redirect(new URL(redirectUrl, url.origin), 302)
  }

  const status = url.searchParams.get('status') || undefined
  const method = url.searchParams.get('method') as 'pr' | 'direct_push' | 'legacy' | undefined
  const deployer = url.searchParams.get('deployer') || undefined
  const sha = url.searchParams.get('sha') || undefined
  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod

  const range = getDateRangeForPeriod(period)

  const navFilters: DeploymentNavFilters = {
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    deployer_username: deployer,
    commit_sha: sha,
    start_date: range?.startDate,
    end_date: range?.endDate,
    audit_start_year: app.audit_start_year,
  }

  const deploymentDate = new Date(deployment.created_at).toISOString().split('T')[0]

  const nearbyDeploymentsPromise =
    deployment.four_eyes_status === 'error'
      ? pool
          .query(
            `SELECT d.id, d.commit_sha, d.created_at, d.four_eyes_status, d.deployer_username,
              ${TITLE_COALESCE_SQL} AS title
       FROM deployments d
       LEFT JOIN commits c ON c.sha = d.commit_sha
         AND c.repo_owner = d.detected_github_owner
         AND c.repo_name = d.detected_github_repo_name
       WHERE d.monitored_app_id = $1
         AND d.id != $2
         AND d.created_at BETWEEN ($3::timestamptz - interval '30 minutes') AND ($3::timestamptz + interval '30 minutes')
       ORDER BY d.created_at`,
            [deployment.monitored_app_id, deploymentId, deployment.created_at],
          )
          .then((r) =>
            r.rows.map((row) => ({
              id: row.id as number,
              commit_sha: row.commit_sha as string,
              created_at: (row.created_at as Date).toISOString(),
              four_eyes_status: row.four_eyes_status as string,
              deployer_username: row.deployer_username as string | null,
              title: row.title as string | null,
            })),
          )
      : Promise.resolve(
          [] as Array<{
            id: number
            commit_sha: string
            created_at: string
            four_eyes_status: string
            deployer_username: string | null
            title: string | null
          }>,
        )

  const [
    comments,
    manualApproval,
    legacyInfo,
    statusHistory,
    deviations,
    goalLinks,
    currentUser,
    allDevTeams,
    previousDeployment,
    nextDeployment,
    previousDeploymentForDiff,
    fullVerificationRun,
    nearbyDeployments,
    registeredRepos,
  ] = await Promise.all([
    getCommentsByDeploymentId(deploymentId),
    getManualApproval(deploymentId),
    getLegacyInfo(deploymentId),
    getStatusHistory(deploymentId),
    getDeviationsByDeploymentId(deploymentId),
    getLinksForDeployment(deploymentId),
    getUserIdentity(request),
    getDevTeamsForApp(deployment.monitored_app_id, app.team_slug),
    getPreviousDeploymentForNav(deploymentId, deployment.monitored_app_id, navFilters),
    getNextDeployment(deploymentId, deployment.monitored_app_id, navFilters),
    getPreviousDeploymentForDiff(deploymentId, deployment.monitored_app_id, app.audit_start_year),
    getLatestVerificationRun(deploymentId),
    nearbyDeploymentsPromise,
    deployment.four_eyes_status === 'unauthorized_repository'
      ? getRepositoriesByAppId(deployment.monitored_app_id)
      : Promise.resolve([]),
  ])

  const capabilities: DeploymentCapabilities = currentUser
    ? await resolveDeploymentCapabilities(currentUser, deployment.monitored_app_id)
    : {
        canApprove: false,
        canVerify: false,
        canDeviate: false,
        canLinkGoal: false,
        canNotify: false,
        canLookupLegacy: false,
        canResetVerification: false,
      }

  let availableBoards: AvailableBoard[] = []
  let sectionBoards: AvailableBoard[] = []

  if (capabilities.canLinkGoal) {
    let devTeams = allDevTeams
    if (currentUser?.navIdent) {
      try {
        const userTeams = await getUserDevTeamsByRole(currentUser.navIdent)
        const userTeamIds = new Set(userTeams.map((t) => t.id))
        const filtered = allDevTeams.filter((dt) => userTeamIds.has(dt.id))
        if (filtered.length > 0) {
          devTeams = filtered
        }
      } catch {
        // Graceful degradation — show all teams if role query fails
      }
    }

    const devTeamIds = new Set(devTeams.map((dt) => dt.id))
    const sectionIds = [...new Set(allDevTeams.map((dt) => dt.section_id))]

    const [boardsPerTeam, sectionTeamArrays] = await Promise.all([
      Promise.all(devTeams.map((dt) => getBoardsWithGoalsForDevTeam(dt.id, deploymentDate))),
      Promise.all(sectionIds.map((sid) => getDevTeamsBySection(sid))),
    ])

    availableBoards = boardsPerTeam.flatMap((boards, i) =>
      boards.map((b) => ({ ...b, dev_team_name: devTeams[i].name })),
    )

    const otherSectionTeams = sectionTeamArrays.flat().filter((dt) => !devTeamIds.has(dt.id))
    const sectionBoardsPerTeam = await Promise.all(
      otherSectionTeams.map((dt) => getBoardsWithGoalsForDevTeam(dt.id, deploymentDate)),
    )
    sectionBoards = sectionBoardsPerTeam.flatMap((boards, i) =>
      boards.map((b) => ({ ...b, dev_team_name: otherSectionTeams[i].name })),
    )
  }

  const identifierSet = new Set<string>()
  const addId = (id: string | null | undefined) => {
    if (id) identifierSet.add(id)
  }

  addId(deployment.deployer_username)
  for (const nd of nearbyDeployments) addId(nd.deployer_username)
  addId(deployment.github_pr_data?.creator?.username)
  addId(deployment.github_pr_data?.merger?.username)
  for (const assignee of deployment.github_pr_data?.assignees ?? []) addId(assignee.username)
  for (const reviewer of deployment.github_pr_data?.reviewers ?? []) addId(reviewer.username)
  for (const reviewer of deployment.github_pr_data?.requested_reviewers ?? []) addId(reviewer.username)
  for (const commit of deployment.github_pr_data?.commits ?? []) addId(commit.author?.username)
  for (const comment of deployment.github_pr_data?.comments ?? []) addId(comment.user?.username)
  for (const commit of deployment.unverified_commits ?? []) addId(commit.author)
  for (const comment of comments) addId(comment.registered_by)
  for (const deviation of deviations) {
    addId(deviation.registered_by)
    addId(deviation.resolved_by)
  }
  for (const link of goalLinks) addId(link.linked_by)

  const userMappings = await getUsersByIdentifiers([...identifierSet])

  let isCurrentUserInvolved = false
  let involvementReason: string | null = null

  if (currentUser?.navIdent) {
    const currentNavIdent = currentUser.navIdent.toUpperCase()

    const prCreatorUsername = deployment.github_pr_data?.creator?.username
    if (prCreatorUsername) {
      const prCreatorMapping = userMappings.get(prCreatorUsername)
      if (prCreatorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        isCurrentUserInvolved = true
        involvementReason = 'Du opprettet pull requesten for denne deploymenten'
      }
    }

    if (!isCurrentUserInvolved && deployment.unverified_commits && deployment.unverified_commits.length > 0) {
      const lastCommit = deployment.unverified_commits[deployment.unverified_commits.length - 1]
      const lastCommitAuthorMapping = userMappings.get(lastCommit.author)
      if (lastCommitAuthorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        isCurrentUserInvolved = true
        involvementReason = 'Du er forfatter av siste commit i denne deploymenten'
      }
    }
  }

  const isAdmin = currentUser?.role === 'admin'

  const verificationRun = isAdmin
    ? fullVerificationRun
    : fullVerificationRun
      ? ({
          status: fullVerificationRun.status,
          runAt: fullVerificationRun.runAt,
          schemaVersion: fullVerificationRun.schemaVersion,
          result: {
            branchMismatch: (
              fullVerificationRun.result as {
                branchMismatch?: { expectedBranch: string; detectedBranches: string[]; prNumbers: number[] }
              } | null
            )?.branchMismatch,
          },
        } as typeof fullVerificationRun)
      : null

  return {
    deployment,
    comments,
    manualApproval,
    legacyInfo,
    statusHistory,
    deviations,
    goalLinks,
    availableBoards,
    sectionBoards,
    previousDeployment,
    previousDeploymentForDiff,
    nextDeployment,
    userMappings: serializeUserLookups(userMappings),
    appUrl,
    currentUserNavIdent: currentUser?.navIdent || null,
    isCurrentUserInvolved,
    involvementReason,
    isDebugMode: isVerificationDebugMode || isAdmin,
    isAdmin,
    capabilities,
    verificationRun,
    nearbyDeployments,
    slackConfig: {
      enabled: app.slack_notifications_enabled,
      channelId: app.slack_channel_id,
      alreadySent: !!deployment.slack_message_ts,
    },
    registeredRepos: registeredRepos
      .filter((r) => r.status === 'active')
      .map((r) => ({ owner: r.github_owner, name: r.github_repo_name })),
    managingTeams:
      deployment.four_eyes_status === 'unauthorized_repository'
        ? allDevTeams.map((dt) => ({ name: dt.name, slug: dt.slug, sectionSlug: dt.section_slug }))
        : [],
  }
}
