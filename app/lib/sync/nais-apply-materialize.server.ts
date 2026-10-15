import { createHash } from 'node:crypto'
import { createRepositoryAlertForDeployment } from '~/db/alerts.server'
import {
  findRepositoryForApp,
  getRepositoriesByAppId,
  isNaisApplyRepositoryRejected,
  upsertApplicationRepository,
} from '~/db/application-repositories.server'
import { upsertNaisApplyDeployment } from '~/db/deployments.server'
import { getMonitoredApplicationById, type MonitoredApplication } from '~/db/monitored-applications.server'
import { getNaisApplyActivityEvents } from '~/db/nais-apply-activity.server'
import { ensureRepositoryRowForGithubRepo, syncRepositoryDefaultBranch } from '~/db/repositories.server'
import { fetchWorkflowRunHeadSha, getRepositoryId } from '~/lib/github/git.server'
import { logger } from '~/lib/logger.server'
import type { NaisApplicationUpdatedActivity } from '~/lib/nais.server'
import { syncDefaultBranchForApp } from './default-branch-sync.server'
import { parseRepository } from './repo-parser'

interface ActivityClaims {
  actor: string
  owner: string
  repo: string
  repositoryId: string
  runId: number
  runAttempt: number
  checkRunId: number | null
}

interface ApplyImageChange {
  activity: NaisApplicationUpdatedActivity
  image: string
  claims: ActivityClaims | null
  sourceId: string
  createdAt: Date
}

interface ApplyRepositoryLink {
  github_owner: string
  github_repo_name: string
  github_repo_id: string | null
  status: 'active' | 'historical' | 'pending_approval'
  redirects_to_owner: string | null
  redirects_to_repo: string | null
  notes: string | null
  approved_at: Date | null
  approved_by: string | null
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parsePositiveInteger(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseClaims(activity: NaisApplicationUpdatedActivity): ActivityClaims | null {
  const claims = activity.gitHubActorClaims
  if (!claims) return null

  const repository = parseRepository(claims.repository)
  const repositoryId = parsePositiveInteger(claims.repositoryID)
  const runId = parsePositiveInteger(claims.runID)
  const runAttempt = parsePositiveInteger(claims.runAttempt)
  const checkRunId = claims.checkRunID === null ? null : parsePositiveInteger(claims.checkRunID)
  if (!repository || !repositoryId || !runId || !runAttempt || (claims.checkRunID !== null && !checkRunId)) {
    return null
  }

  return {
    actor: claims.actor,
    owner: repository.owner,
    repo: repository.repo,
    repositoryId: String(repositoryId),
    runId,
    runAttempt,
    checkRunId,
  }
}

function getImageChanges(activity: NaisApplicationUpdatedActivity): ApplyImageChange[] {
  const claims = parseClaims(activity)
  const createdAt = new Date(activity.createdAt)
  if (!Number.isFinite(createdAt.getTime())) {
    throw new Error(`Invalid Nais Apply activity timestamp: ${activity.id}`)
  }

  return activity.changedFields.flatMap((field) => {
    if (field.field !== 'spec.image' || !field.newValue || field.newValue === field.oldValue) return []

    const sourceId =
      claims && claims.checkRunId !== null
        ? `nais-apply:${claims.repositoryId}:${claims.runId}:${claims.runAttempt}:${claims.checkRunId}:${hash(field.newValue)}`
        : `nais-apply:activity:${hash(activity.id)}`
    return [{ activity, image: field.newValue, claims, sourceId, createdAt }]
  })
}

function groupImageChanges(changes: ApplyImageChange[]): ApplyImageChange[][] {
  const groups = new Map<string, ApplyImageChange[]>()
  for (const change of changes) {
    const group = groups.get(change.sourceId) ?? []
    group.push(change)
    groups.set(change.sourceId, group)
  }
  return [...groups.values()]
}

async function ensureApplyRepositoryLink(
  app: MonitoredApplication,
  claims: ActivityClaims,
): Promise<ApplyRepositoryLink | null> {
  const monitoredAppId = app.id
  const actualRepositoryId = await getRepositoryId(claims.owner, claims.repo)
  if (actualRepositoryId === null || String(actualRepositoryId) !== claims.repositoryId) {
    logger.warn('Nais Apply GitHub repository claim did not match the current repository identity', {
      monitoredAppId,
      owner: claims.owner,
      repo: claims.repo,
      claimedRepositoryId: claims.repositoryId,
      actualRepositoryId,
    })
    return null
  }

  if (await isNaisApplyRepositoryRejected(monitoredAppId, claims.repositoryId)) return null

  const repoCheck = await findRepositoryForApp(monitoredAppId, claims.owner, claims.repo)
  let repository = repoCheck.repository

  if (repository && repository.github_repo_id !== claims.repositoryId) {
    if (repository.github_repo_id !== null) {
      logger.warn('Nais Apply repository claim does not match the application repository link', {
        monitoredAppId,
        owner: claims.owner,
        repo: claims.repo,
        claimedRepositoryId: claims.repositoryId,
        linkedRepositoryId: repository.github_repo_id,
      })
      return null
    }

    repository = await upsertApplicationRepository({
      monitoredAppId,
      githubOwner: repository.github_owner,
      githubRepoName: repository.github_repo_name,
      status: repository.status,
      redirectsToOwner: repository.redirects_to_owner,
      redirectsToRepo: repository.redirects_to_repo,
      notes: repository.notes,
      approvedBy: repository.approved_by,
      approvedAt: repository.approved_at,
      expectedGithubRepoId: claims.repositoryId,
    })
  }

  if (!repository) {
    const existingRepositories = await getRepositoriesByAppId(monitoredAppId)
    repository = await upsertApplicationRepository({
      monitoredAppId,
      githubOwner: claims.owner,
      githubRepoName: claims.repo,
      status: existingRepositories.length === 0 ? 'active' : 'pending_approval',
      expectedGithubRepoId: claims.repositoryId,
      ...(existingRepositories.length === 0 ? { approvedBy: 'system' } : {}),
    })
  }

  if (repository.github_repo_id !== claims.repositoryId) {
    logger.warn('Nais Apply repository link could not be verified against the GitHub repository claim', {
      monitoredAppId,
      owner: claims.owner,
      repo: claims.repo,
      claimedRepositoryId: claims.repositoryId,
      linkedRepositoryId: repository.github_repo_id,
    })
    return null
  }

  if (repository.status === 'active') {
    const activeRepositories = await getRepositoriesByAppId(monitoredAppId)
    const latestActiveRepository = activeRepositories.find((linkedRepository) => linkedRepository.status === 'active')
    if (latestActiveRepository?.github_repo_id === claims.repositoryId) {
      try {
        const syncedAt = new Date()
        await syncRepositoryDefaultBranch({
          monitoredAppId,
          defaultBranch: app.default_branch,
          syncedAt,
          onlyIfMissing: true,
          expectedGithubRepoId: claims.repositoryId,
        })
        await syncDefaultBranchForApp({
          monitoredAppId,
          appName: app.app_name,
          currentDefaultBranch: app.default_branch,
          defaultBranchSyncedAt: app.default_branch_synced_at,
          owner: claims.owner,
          repo: claims.repo,
          expectedGithubRepoId: claims.repositoryId,
        })
      } catch (error) {
        logger.warn('Nais Apply repository default-branch sync failed', {
          monitoredAppId,
          owner: claims.owner,
          repo: claims.repo,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return repository
}

export async function materializeNaisApplyDeployments(
  monitoredAppId: number,
  options: { suppressNotifications?: boolean } = {},
): Promise<number> {
  const app = await getMonitoredApplicationById(monitoredAppId)
  if (!app) throw new Error(`Application not found in monitored applications: ${monitoredAppId}`)

  const events = await getNaisApplyActivityEvents(monitoredAppId)
  const eligibleEvents = events.filter((event) => {
    if (event.environmentName === app.environment_name) return true
    logger.warn('Skipping Nais Apply activity without matching environment', {
      monitoredAppId,
      activityLogId: event.id,
      activityEnvironmentName: event.environmentName,
      monitoredEnvironmentName: app.environment_name,
    })
    return false
  })
  const groups = groupImageChanges(eligibleEvents.flatMap(getImageChanges))
  const resolvedRuns = new Map<string, Promise<string | null>>()
  const repositoryLinks = new Map<string, Promise<ApplyRepositoryLink | null>>()
  const ensuredRepositoryRows = new Set<string>()

  for (const group of groups) {
    const representative = group[0]
    const claims = representative.claims
    let commitSha: string | null = null

    if (claims) {
      const runKey = `${claims.repositoryId}:${claims.runId}:${claims.runAttempt}`
      let resolution = resolvedRuns.get(runKey)
      if (!resolution) {
        resolution = fetchWorkflowRunHeadSha(
          claims.owner,
          claims.repo,
          claims.runId,
          claims.runAttempt,
          claims.repositoryId,
        )
        resolvedRuns.set(runKey, resolution)
      }
      commitSha = await resolution
    }

    let repositoryLink: ApplyRepositoryLink | null = null
    if (claims) {
      const repositoryKey = `${claims.repositoryId}:${claims.owner}/${claims.repo}`
      let link = repositoryLinks.get(repositoryKey)
      if (!link) {
        link = ensureApplyRepositoryLink(app, claims)
        repositoryLinks.set(repositoryKey, link)
      }
      repositoryLink = await link
    }

    if (
      repositoryLink &&
      (repositoryLink.status === 'active' || repositoryLink.status === 'historical') &&
      claims &&
      !ensuredRepositoryRows.has(claims.repositoryId)
    ) {
      await ensureRepositoryRowForGithubRepo({
        githubRepoId: claims.repositoryId,
        githubOwner: claims.owner,
        githubRepoName: claims.repo,
      })
      ensuredRepositoryRows.add(claims.repositoryId)
    }

    const firstChange = group.reduce((earliest, change) => (change.createdAt < earliest.createdAt ? change : earliest))
    const deployment = await upsertNaisApplyDeployment({
      monitoredApplicationId: app.id,
      sourceId: representative.sourceId,
      createdAt: firstChange.createdAt,
      teamSlug: app.team_slug,
      environmentName: app.environment_name,
      appName: app.app_name,
      title: `Nais Apply: ${representative.image}`,
      suppressNotifications: options.suppressNotifications,
      deployerUsername: claims?.actor || representative.activity.actor || null,
      commitSha,
      triggerUrl: claims ? `https://github.com/${claims.owner}/${claims.repo}/actions/runs/${claims.runId}` : null,
      detectedGithubOwner: claims?.owner ?? null,
      detectedGithubRepoName: claims?.repo ?? null,
      detectedGithubRepositoryId:
        repositoryLink?.status === 'active' || repositoryLink?.status === 'historical'
          ? (claims?.repositoryId ?? null)
          : null,
      resources: [{ id: representative.sourceId, kind: 'Image', name: representative.image }],
    })

    if (repositoryLink?.status === 'pending_approval' && claims) {
      await createRepositoryAlertForDeployment({
        monitoredApplicationId: app.id,
        deploymentId: deployment.id,
        detectedGithubOwner: claims.owner,
        detectedGithubRepoName: claims.repo,
        alertType: 'pending_approval',
      })
    } else if (repositoryLink?.status === 'historical' && claims) {
      const activeRepository = (await getRepositoriesByAppId(app.id)).find(
        (repository) => repository.status === 'active',
      )
      await createRepositoryAlertForDeployment({
        monitoredApplicationId: app.id,
        deploymentId: deployment.id,
        detectedGithubOwner: claims.owner,
        detectedGithubRepoName: claims.repo,
        expectedGithubOwner: activeRepository?.github_owner,
        expectedGithubRepoName: activeRepository?.github_repo_name,
        alertType: 'historical_repository',
      })
    }
  }

  return groups.length
}
