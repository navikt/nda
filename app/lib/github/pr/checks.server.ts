import type { GitHubPRData } from '~/db/deployments.server'
import { logger } from '~/lib/logger.server'
import {
  CHECKS_SNAPSHOT_SCHEMA_VERSION,
  type ChecksSnapshotData,
  computeChecksPassed,
  isChecksResultDefinitive,
  mapRawCheckRunToCheckRun,
  type RawCheckAnnotation,
  type RawCheckRun,
} from '../checks-snapshot'
import { getGitHubClient } from '../client.server'

const ANNOTATION_CONCURRENCY_LIMIT = 5

export type CheckRun = GitHubPRData['checks'][number]

type OctokitClient = ReturnType<typeof getGitHubClient>

function filterCheckRunsByCheckSuite<T extends { check_suite: { id: number } | null }>(
  checkRuns: T[],
  checkSuiteId: number | null | undefined,
  owner: string,
  repo: string,
  ref: string,
): T[] {
  if (checkSuiteId == null) return checkRuns
  const scoped = checkRuns.filter((check) => check.check_suite?.id === checkSuiteId)
  if (scoped.length > 0 || checkRuns.length === 0) return scoped
  logger.warn(
    `No check runs matched check_suite_id ${checkSuiteId} for ${owner}/${repo}@${ref}, falling back to all ${checkRuns.length} check run(s) found for this ref`,
  )
  return checkRuns
}

async function fetchChecksForRefs(
  client: OctokitClient,
  owner: string,
  repo: string,
  ref: string,
  checkSuiteId?: number | null,
): Promise<{
  checks_passed: boolean | null
  checks: CheckRun[]
  rawSnapshot: ChecksSnapshotData
  isDefinitive: boolean
}> {
  const rawCheckRuns: RawCheckRun[] = []
  let githubApiVersion: string | undefined

  const captureApiVersionMetadata = (headers: Record<string, unknown>): void => {
    githubApiVersion ??= headers['x-github-api-version-selected'] as string | undefined
    const deprecation = headers.deprecation
    const sunset = headers.sunset
    if (deprecation || sunset) {
      logger.warn(
        `GitHub API version ${githubApiVersion} used for checks on ${owner}/${repo}@${ref} is closing down (deprecation=${deprecation}, sunset=${sunset})`,
      )
    }
  }

  const checkRunsWithAnnotations = await client.paginate(
    client.checks.listForRef,
    { owner, repo, ref, per_page: 100 },
    (response) => {
      captureApiVersionMetadata(response.headers)
      return response.data
    },
  )

  const checkRunsToProcess = filterCheckRunsByCheckSuite(checkRunsWithAnnotations, checkSuiteId, owner, repo, ref)

  if (checkRunsToProcess.length > 0) {
    const annotationResults: Array<{
      check: (typeof checkRunsToProcess)[0]
      annotations: RawCheckAnnotation[] | null
      annotationsFetchFailed: boolean
    }> = []

    for (let i = 0; i < checkRunsToProcess.length; i += ANNOTATION_CONCURRENCY_LIMIT) {
      const batch = checkRunsToProcess.slice(i, i + ANNOTATION_CONCURRENCY_LIMIT)
      const batchResults = await Promise.all(
        batch.map(async (check) => {
          let annotations: RawCheckAnnotation[] | null = null
          let annotationsFetchFailed = false
          if (check.output?.annotations_count && check.output.annotations_count > 0) {
            try {
              annotations = await client.paginate(
                client.checks.listAnnotations,
                { owner, repo, check_run_id: check.id, per_page: 100 },
                (response) => {
                  captureApiVersionMetadata(response.headers)
                  return response.data
                },
              )
            } catch (error) {
              annotationsFetchFailed = true
              logger.warn(`Could not fetch annotations for check run ${check.id} on ${owner}/${repo}: ${error}`)
            }
          }
          return { check, annotations, annotationsFetchFailed }
        }),
      )
      annotationResults.push(...batchResults)
    }

    for (const { check, annotations, annotationsFetchFailed } of annotationResults) {
      rawCheckRuns.push({ ...check, annotations, ...(annotationsFetchFailed ? { annotationsFetchFailed } : {}) })
    }
  }

  const rawSnapshot: ChecksSnapshotData = {
    schemaVersion: CHECKS_SNAPSHOT_SCHEMA_VERSION,
    githubApiVersion,
    checkRuns: rawCheckRuns,
  }
  const checks_passed = computeChecksPassed(rawCheckRuns)
  const isDefinitive = isChecksResultDefinitive(rawCheckRuns)

  return { checks_passed, checks: rawCheckRuns.map(mapRawCheckRunToCheckRun), rawSnapshot, isDefinitive }
}

export async function getChecksForCommit(
  owner: string,
  repo: string,
  sha: string,
  fallbackSha?: string | null,
  checkSuiteId?: number | null,
): Promise<{
  checks_passed: boolean | null
  checks: CheckRun[]
  rawSnapshot: ChecksSnapshotData
  matchedSha: string
  isDefinitive: boolean
} | null> {
  const client = getGitHubClient()
  const result = await fetchChecksForRefs(client, owner, repo, sha, checkSuiteId)
  if (result.checks.length > 0) return { ...result, matchedSha: sha }

  if (fallbackSha && fallbackSha !== sha) {
    const fallbackResult = await fetchChecksForRefs(client, owner, repo, fallbackSha)
    if (fallbackResult.checks.length > 0) return { ...fallbackResult, matchedSha: fallbackSha }
  }

  return null
}
