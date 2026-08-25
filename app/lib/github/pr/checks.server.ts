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
import { type ApiVersionMetadata, captureApiVersionMetadata } from '../pr-snapshot'

const ANNOTATION_CONCURRENCY_LIMIT = 5

export type CheckRun = GitHubPRData['checks'][number]

type OctokitClient = ReturnType<typeof getGitHubClient>

function filterCheckRunsByCheckSuite<T extends { check_suite: { id: number } | null }>(
  checkRuns: T[],
  checkSuiteId: number | null | undefined,
  owner: string,
  repo: string,
  ref: string,
): { checkRuns: T[]; effectiveCheckSuiteId: number | null } {
  if (checkSuiteId == null) return { checkRuns, effectiveCheckSuiteId: null }
  const scoped = checkRuns.filter((check) => check.check_suite?.id === checkSuiteId)
  if (scoped.length > 0 || checkRuns.length === 0) return { checkRuns: scoped, effectiveCheckSuiteId: checkSuiteId }
  logger.warn(
    `No check runs matched check_suite_id ${checkSuiteId} for ${owner}/${repo}@${ref}, falling back to all ${checkRuns.length} check run(s) found for this ref`,
  )
  return { checkRuns, effectiveCheckSuiteId: null }
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
  rawCheckRuns: RawCheckRun[]
  rawSnapshot: ChecksSnapshotData
  isDefinitive: boolean
  apiVersion: ApiVersionMetadata
  effectiveCheckSuiteId: number | null
}> {
  const rawCheckRuns: RawCheckRun[] = []
  let apiVersion: ApiVersionMetadata = { apiVersion: 'unknown', apiDeprecatedAt: null, apiSunsetAt: null }

  const trackApiVersionMetadata = (headers: Record<string, unknown>): void => {
    apiVersion = captureApiVersionMetadata(headers, apiVersion)
    if (apiVersion.apiDeprecatedAt || apiVersion.apiSunsetAt) {
      logger.warn(
        `GitHub API version ${apiVersion.apiVersion} used for checks on ${owner}/${repo}@${ref} is closing down (deprecation=${apiVersion.apiDeprecatedAt}, sunset=${apiVersion.apiSunsetAt})`,
      )
    }
  }

  const checkRunsWithAnnotations = await client.paginate(
    client.checks.listForRef,
    { owner, repo, ref, per_page: 100 },
    (response) => {
      trackApiVersionMetadata(response.headers)
      return response.data
    },
  )

  const { checkRuns: checkRunsToProcess, effectiveCheckSuiteId } = filterCheckRunsByCheckSuite(
    checkRunsWithAnnotations,
    checkSuiteId,
    owner,
    repo,
    ref,
  )

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
                  trackApiVersionMetadata(response.headers)
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
    githubApiVersion: apiVersion.apiVersion,
    checkRuns: rawCheckRuns,
  }
  const checks_passed = computeChecksPassed(rawCheckRuns)
  const isDefinitive = isChecksResultDefinitive(rawCheckRuns)

  return {
    checks_passed,
    checks: rawCheckRuns.map(mapRawCheckRunToCheckRun),
    rawCheckRuns,
    rawSnapshot,
    isDefinitive,
    apiVersion,
    effectiveCheckSuiteId,
  }
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
  rawCheckRuns: RawCheckRun[]
  rawSnapshot: ChecksSnapshotData
  matchedSha: string
  matchedCheckSuiteId: number | null
  isDefinitive: boolean
  apiVersion: ApiVersionMetadata
}> {
  const client = getGitHubClient()
  const result = await fetchChecksForRefs(client, owner, repo, sha, checkSuiteId)
  if (result.checks.length > 0) return { ...result, matchedSha: sha, matchedCheckSuiteId: result.effectiveCheckSuiteId }

  if (fallbackSha && fallbackSha !== sha) {
    const fallbackResult = await fetchChecksForRefs(client, owner, repo, fallbackSha)
    if (fallbackResult.checks.length > 0)
      return { ...fallbackResult, matchedSha: fallbackSha, matchedCheckSuiteId: null }
  }

  return { ...result, matchedSha: sha, matchedCheckSuiteId: result.effectiveCheckSuiteId }
}
