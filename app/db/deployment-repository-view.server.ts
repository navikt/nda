import type { UserIdentity } from '~/lib/auth.server'
import { resolveRepositoryApprovalCapabilities } from '~/lib/authorization.server'
import type { FourEyesStatus } from '~/lib/four-eyes-status'
import { isFullCommitSha } from '~/lib/git-constants'
import { isRepositoryBotAuthor } from '~/lib/repository-code-delivery/approval-assessment-display'
import { serializeUserLookups } from '~/lib/user-display'
import { withTransaction } from './connection.server'
import { getRepositoryCodeDelivery } from './repository-code-deliveries.server'
import type { UnresolvedReason } from './repository-code-delivery-establishment.server'
import { repositoryCodeDeliveryRepositoryIdSql } from './repository-code-delivery-predecessor-sql'
import { getStoredRepositoryDeliveryAssessments } from './repository-delivery-assessments.server'
import { getGithubUserLookups } from './user-github-lookups.server'

interface DeploymentContext {
  id: number
  monitored_app_id: number
  team_slug: string
  environment_name: string
  app_name: string
  created_at: Date
  commit_sha: string | null
  branch_name: string | null
  deployer_username: string | null
  four_eyes_status: FourEyesStatus | null
  repository_id: number | null
  repository_code_delivery_id: number | null
  github_owner: string | null
  github_repo_name: string | null
  code_delivery_tracking: boolean | null
  code_delivery_tracking_since: Date | null
  unresolved_reason: UnresolvedReason | null
  verification_run_at: Date | null
  verification_base_sha: string | null
  verification_head_sha: string | null
}

export async function getDeploymentRepositoryView(
  deploymentId: number,
  actor: UserIdentity | null,
  monitoredAppId: number,
) {
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const { rows } = await client.query<DeploymentContext>(
      `SELECT d.id, d.monitored_app_id, ma.team_slug, ma.environment_name, ma.app_name, d.created_at,
              d.commit_sha, d.branch_name, d.deployer_username, d.four_eyes_status,
              COALESCE(d.repository_id, identity.repository_id) AS repository_id, d.repository_code_delivery_id,
              r.github_owner, r.github_repo_name, r.code_delivery_tracking, r.code_delivery_tracking_since,
              u.reason AS unresolved_reason, vr.run_at AS verification_run_at,
              vr.result->'comparisonRange'->>'baseSha' AS verification_base_sha,
              vr.result->'comparisonRange'->>'headSha' AS verification_head_sha
       FROM deployments d
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       LEFT JOIN repository_code_delivery_deployment_repositories identity ON identity.deployment_id = d.id
       LEFT JOIN repositories r ON r.id = COALESCE(d.repository_id, identity.repository_id)
       LEFT JOIN repository_code_delivery_unresolved u ON u.deployment_id = d.id AND u.resolved_at IS NULL
       LEFT JOIN LATERAL (
         SELECT run_at, result FROM verification_runs
         WHERE deployment_id = d.id ORDER BY run_at DESC, id DESC LIMIT 1
       ) vr ON true
       WHERE d.id = $1 AND d.monitored_app_id = $2`,
      [deploymentId, monitoredAppId],
    )
    const deployment = rows[0]
    if (!deployment) return null

    const applicationRange =
      deployment.verification_base_sha &&
      deployment.verification_head_sha &&
      isFullCommitSha(deployment.verification_base_sha) &&
      isFullCommitSha(deployment.verification_head_sha)
        ? { baseSha: deployment.verification_base_sha, headSha: deployment.verification_head_sha }
        : null
    const context = {
      deployment: {
        id: deployment.id,
        teamSlug: deployment.team_slug,
        environmentName: deployment.environment_name,
        appName: deployment.app_name,
        createdAt: deployment.created_at,
        commitSha: deployment.commit_sha,
        branchName: deployment.branch_name,
      },
      application: {
        status: deployment.four_eyes_status,
        verificationRunAt: deployment.verification_run_at,
        range: applicationRange,
      },
      repository:
        deployment.repository_id !== null && deployment.github_owner && deployment.github_repo_name
          ? {
              id: deployment.repository_id,
              githubOwner: deployment.github_owner,
              githubRepoName: deployment.github_repo_name,
            }
          : null,
    }
    const candidate =
      context.repository && deployment.commit_sha && isFullCommitSha(deployment.commit_sha)
        ? await getRepositoryCodeDelivery(context.repository.id, deployment.commit_sha, client)
        : null
    if (deployment.repository_code_delivery_id === null) {
      const reason = !context.repository
        ? ('missing_repository' as const)
        : !deployment.commit_sha || !isFullCommitSha(deployment.commit_sha)
          ? ('missing_commit_sha' as const)
          : deployment.unresolved_reason
            ? ('unresolved' as const)
            : !deployment.code_delivery_tracking
              ? ('tracking_disabled' as const)
              : ('unlinked' as const)
      const lookups = await getGithubUserLookups(
        deployment.deployer_username ? [deployment.deployer_username] : [],
        client,
      )
      return {
        ...context,
        link: {
          state: 'missing' as const,
          reason,
          unresolvedReason: deployment.unresolved_reason,
          candidate: candidate ? { id: candidate.id, baseSha: candidate.base_sha, headSha: candidate.head_sha } : null,
        },
        deployerUsername: deployment.deployer_username,
        userMappings: serializeUserLookups(lookups),
      }
    }
    if (!context.repository || !candidate || candidate.id !== deployment.repository_code_delivery_id) {
      throw new Error(`Deployment ${deploymentId} has an inconsistent repository code delivery link`)
    }

    const { assessments, lookups } = await getStoredRepositoryDeliveryAssessments(
      client,
      context.repository.id,
      [candidate],
      deployment.deployer_username ? [deployment.deployer_username] : [],
    )
    const evaluated = assessments.get(candidate.id)
    if (!evaluated) throw new Error(`Missing approval assessment for delivery ${candidate.id}`)
    const { interval, assessment } = evaluated
    const capabilities = actor
      ? await resolveRepositoryApprovalCapabilities(actor, context.repository.id, client)
      : { canApprove: false, canAccessAdmin: false }
    const { rows: deployments } = await client.query<{
      id: number
      teamSlug: string
      environmentName: string
      appName: string
      createdAt: Date
      total: number
    }>(
      `SELECT d.id, ma.team_slug AS "teamSlug", ma.environment_name AS "environmentName",
              ma.app_name AS "appName", d.created_at AS "createdAt", count(*) OVER ()::int AS total
       FROM deployments d
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       WHERE ${repositoryCodeDeliveryRepositoryIdSql} = $1 AND d.repository_code_delivery_id = $2
       ORDER BY d.created_at, d.id LIMIT 20`,
      [context.repository.id, candidate.id],
    )
    const commits = new Map(interval.commits.map((commit) => [commit.sha.toLowerCase(), commit]))
    return {
      ...context,
      link: {
        state: 'linked' as const,
        delivery: { id: candidate.id, baseSha: candidate.base_sha, headSha: candidate.head_sha },
        assessment,
        commits: assessment.commits.map((commit) => ({
          ...commit,
          authorLogin: commits.get(commit.sha.toLowerCase())?.authorLogin ?? null,
          pullRequestNumber: commits.get(commit.sha.toLowerCase())?.pullRequestNumber ?? null,
          prReason:
            commit.reason === 'unknown_pr_coverage' ||
            (commit.reason === 'unknown_commit_author' &&
              isRepositoryBotAuthor(commits.get(commit.sha.toLowerCase())?.authorLogin))
              ? (commits.get(commit.sha.toLowerCase())?.reason ?? null)
              : null,
        })),
        deployments: deployments.map(({ total: _total, ...row }) => row),
        deploymentCount: deployments[0]?.total ?? 0,
        canApprove: capabilities.canApprove,
        canAccessAdmin: capabilities.canAccessAdmin,
      },
      deployerUsername: deployment.deployer_username,
      userMappings: serializeUserLookups(lookups),
    }
  })
}

export type DeploymentRepositoryView = NonNullable<Awaited<ReturnType<typeof getDeploymentRepositoryView>>>
