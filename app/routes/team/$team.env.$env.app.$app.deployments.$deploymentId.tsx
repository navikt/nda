import { DeploymentDetailPage } from '~/components/DeploymentDetailPage'
import { DeploymentRepositoryPage } from '~/components/DeploymentRepositoryPage'
import { getDeploymentRepositoryView } from '~/db/deployment-repository-view.server'
import { getDeploymentById, getPreviousDeploymentForDiff } from '~/db/deployments.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getUsersByIdentifiers } from '~/db/user-github-lookups.server'
import { getCompareSnapshotForCommit } from '~/db/verification-diff.server'
import { getUserIdentity } from '~/lib/auth.server'
import { computeDisplayTitle, isExclusivelyThisPr } from '~/lib/delivery-title'
import { getDeploymentView } from '~/lib/deployment-view'
import { getBotDisplayName, isGitHubBot } from '~/lib/github-bots'
import { requireParams } from '~/lib/route-params.server'
import { serializeUserLookups } from '~/lib/user-display'
import { getPrDataForDiff } from '~/lib/verification'
import type { CompareData } from '~/lib/verification/types'
import { action as deploymentAction, loader as deploymentLoader } from '../deployments/$id'
import type { Route } from './+types/$team.env.$env.app.$app.deployments.$deploymentId'

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const { team, env, app: appName, deploymentId } = requireParams(params, ['team', 'env', 'app', 'deploymentId'])
  const id = Number.parseInt(deploymentId, 10)
  if (
    !/^\d+$/.test(deploymentId) ||
    !Number.isFinite(id) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    id > 2_147_483_647
  ) {
    throw new Response('Invalid deployment ID', { status: 400 })
  }

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  if (getDeploymentView(url.searchParams.get('view')) === 'repository') {
    const user = await getUserIdentity(request)
    const [repositoryView, deploymentDetails, previousDeploymentForDiff] = await Promise.all([
      getDeploymentRepositoryView(id, user, app.id),
      getDeploymentById(id),
      getPreviousDeploymentForDiff(id, app.id),
    ])
    if (!repositoryView || !deploymentDetails || deploymentDetails.monitored_app_id !== app.id) {
      throw new Response('Deployment not found', { status: 404 })
    }

    const applicationRange = repositoryView.application.range
    const applicationIntervalMatchesDeployment =
      applicationRange?.headSha === deploymentDetails.commit_sha && Boolean(deploymentDetails.commit_sha)
    const repositoryIdentity =
      deploymentDetails.commit_sha &&
      deploymentDetails.detected_github_owner &&
      deploymentDetails.detected_github_repo_name
        ? {
            commitSha: deploymentDetails.commit_sha,
            owner: deploymentDetails.detected_github_owner,
            repo: deploymentDetails.detected_github_repo_name,
          }
        : null
    const applicationRangeOwner = repositoryView.repository?.githubOwner ?? repositoryIdentity?.owner
    const applicationRangeRepo = repositoryView.repository?.githubRepoName ?? repositoryIdentity?.repo
    const applicationRangeRepositoryIdentity =
      applicationIntervalMatchesDeployment &&
      applicationRange &&
      deploymentDetails.commit_sha &&
      applicationRangeOwner &&
      applicationRangeRepo
        ? {
            commitSha: deploymentDetails.commit_sha,
            owner: applicationRangeOwner,
            repo: applicationRangeRepo,
          }
        : null
    const latestCompareSnapshot =
      repositoryIdentity && previousDeploymentForDiff
        ? await getCompareSnapshotForCommit(
            repositoryIdentity.owner,
            repositoryIdentity.repo,
            repositoryIdentity.commitSha,
          )
        : null
    const applicationTitleCommitShas =
      previousDeploymentForDiff &&
      latestCompareSnapshot &&
      latestCompareSnapshot.base_sha === previousDeploymentForDiff.commit_sha
        ? (latestCompareSnapshot.data as CompareData).commits.map((commit) => commit.sha)
        : []
    const [currentApplicationRangeSnapshot, prData] = await Promise.all([
      applicationRangeRepositoryIdentity && applicationRange
        ? repositoryIdentity?.owner === applicationRangeRepositoryIdentity.owner &&
          repositoryIdentity.repo === applicationRangeRepositoryIdentity.repo &&
          latestCompareSnapshot?.base_sha === applicationRange.baseSha
          ? latestCompareSnapshot
          : getCompareSnapshotForCommit(
              applicationRangeRepositoryIdentity.owner,
              applicationRangeRepositoryIdentity.repo,
              applicationRangeRepositoryIdentity.commitSha,
              applicationRange.baseSha,
            )
        : Promise.resolve(null),
      applicationTitleCommitShas.length > 1 && deploymentDetails.github_pr_number && repositoryIdentity
        ? getPrDataForDiff(repositoryIdentity.owner, repositoryIdentity.repo, deploymentDetails.github_pr_number)
        : Promise.resolve(null),
    ])
    const applicationRangeSnapshot =
      !currentApplicationRangeSnapshot &&
      applicationRangeRepositoryIdentity &&
      applicationRange &&
      repositoryIdentity &&
      (repositoryIdentity.owner !== applicationRangeRepositoryIdentity.owner ||
        repositoryIdentity.repo !== applicationRangeRepositoryIdentity.repo)
        ? await getCompareSnapshotForCommit(
            repositoryIdentity.owner,
            repositoryIdentity.repo,
            repositoryIdentity.commitSha,
            applicationRange.baseSha,
          )
        : currentApplicationRangeSnapshot
    const deliveryCommits =
      applicationRangeSnapshot && applicationRange && applicationRangeSnapshot.base_sha === applicationRange.baseSha
        ? (applicationRangeSnapshot.data as CompareData).commits.map((commit) => ({
            sha: commit.sha,
            message: commit.message,
            authorUsername: commit.authorUsername,
            htmlUrl: commit.htmlUrl,
            isBot: isGitHubBot(commit.authorUsername),
            botDisplayName: getBotDisplayName(commit.authorUsername),
          }))
        : null
    const prCommitShas = prData ? new Set(prData.commits.map((commit) => commit.sha)) : null
    const displayTitle = computeDisplayTitle(
      deploymentDetails.title,
      applicationTitleCommitShas.length || 1,
      isExclusivelyThisPr(deploymentDetails.github_pr_number !== null, applicationTitleCommitShas, prCommitShas),
    )
    const githubUsernames = new Set<string>()
    const addUsername = (username: string | null | undefined) => {
      if (username) githubUsernames.add(username)
    }
    const prDetails = deploymentDetails.github_pr_data
    addUsername(prDetails?.creator?.username)
    addUsername(prDetails?.merger?.username)
    for (const assignee of prDetails?.assignees ?? []) addUsername(assignee.username)
    for (const reviewer of prDetails?.reviewers ?? []) addUsername(reviewer.username)
    for (const reviewer of prDetails?.requested_reviewers ?? []) addUsername(reviewer.username)
    for (const commit of prDetails?.commits ?? []) addUsername(commit.author?.username)
    for (const comment of prDetails?.comments ?? []) addUsername(comment.user?.username)
    for (const commit of deliveryCommits ?? []) addUsername(commit.authorUsername)
    const additionalUserMappings = serializeUserLookups(await getUsersByIdentifiers([...githubUsernames]))
    const userMappings = { ...repositoryView.userMappings, ...additionalUserMappings }
    const deploymentPresentation = {
      created_at: deploymentDetails.created_at,
      deployer_username: deploymentDetails.deployer_username,
      commit_sha: deploymentDetails.commit_sha,
      nais_deployment_id: deploymentDetails.nais_deployment_id,
      deployment_source: deploymentDetails.deployment_source,
      deployment_source_id: deploymentDetails.deployment_source_id,
      branch_name: deploymentDetails.branch_name,
      trigger_url: deploymentDetails.trigger_url,
      parent_commits: deploymentDetails.parent_commits,
      detected_github_owner: deploymentDetails.detected_github_owner,
      detected_github_repo_name: deploymentDetails.detected_github_repo_name,
      github_pr_number: deploymentDetails.github_pr_number,
      github_pr_url: deploymentDetails.github_pr_url,
      github_pr_data: deploymentDetails.github_pr_data,
      commit_checks_data: deploymentDetails.commit_checks_data,
    }

    return {
      view: 'repository' as const,
      repositoryView,
      deploymentDetails: {
        deployment: deploymentPresentation,
        deliveryCommits,
        displayTitle,
        previousDeploymentForDiff: applicationIntervalMatchesDeployment
          ? { commit_sha: applicationRange.baseSha }
          : null,
        previousDeploymentForDiffLabel: 'Endringer i lagret applikasjonsintervall',
        sameCommitMessage: 'Det lagrede applikasjonsintervallet inneholder ingen endringer (samme commit).',
        userMappings,
        workflowTrigger: deploymentDetails.workflow_trigger_config,
      },
      deployment: repositoryView.deployment,
      app,
    }
  }

  const result = await deploymentLoader({
    params: { id: deploymentId },
    request,
    url,
  } as Parameters<typeof deploymentLoader>[0])

  if (result instanceof Response) {
    return result
  }
  if (result.deployment.monitored_app_id !== app.id) {
    throw new Response('Deployment not found', { status: 404 })
  }

  return {
    ...result,
    view: 'application' as const,
    app,
    appContext: true,
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  const deployment = data?.deployment
  return [{ title: deployment ? `Deployment #${deployment.id} - NDA` : 'Deployment' }]
}

export async function action({ params, request, url }: Route.ActionArgs) {
  return deploymentAction({
    params: { id: params.deploymentId },
    request,
    url,
  } as Parameters<typeof deploymentAction>[0])
}

export default function DeploymentView({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.view === 'repository') {
    return (
      <DeploymentRepositoryPage
        data={loaderData.repositoryView}
        deploymentDetails={loaderData.deploymentDetails}
        actionData={actionData}
      />
    )
  }
  return <DeploymentDetailPage loaderData={loaderData} actionData={actionData} />
}
