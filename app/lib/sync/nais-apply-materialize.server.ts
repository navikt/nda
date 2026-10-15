import { createHash } from 'node:crypto'
import { upsertNaisApplyDeployment } from '~/db/deployments.server'
import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import { getNaisApplyActivityEvents } from '~/db/nais-apply-activity.server'
import { fetchWorkflowRunHeadSha } from '~/lib/github/git.server'
import { logger } from '~/lib/logger.server'
import type { NaisApplicationUpdatedActivity } from '~/lib/nais.server'
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

    const firstChange = group.reduce((earliest, change) => (change.createdAt < earliest.createdAt ? change : earliest))
    await upsertNaisApplyDeployment({
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
      resources: {
        nodes: [{ id: representative.sourceId, kind: 'Image', name: representative.image }],
      },
    })
  }

  return groups.length
}
