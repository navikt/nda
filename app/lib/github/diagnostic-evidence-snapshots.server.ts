import type { RestEndpointMethodTypes } from '@octokit/rest'
import {
  getAllLatestPrRawSnapshotsByRepositoryId,
  getLatestWorkflowJobsRawSnapshot,
  savePrRawSnapshotsBatch,
  saveWorkflowJobsRawSnapshot,
} from '~/db/github-data.server'
import { logger } from '~/lib/logger.server'
import {
  GITHUB_RATE_LIMIT_SAFETY_BUFFER,
  getGitHubClient,
  getGitHubRateLimitError,
  getGitHubRateLimitRemaining,
} from './client.server'
import { type ApiVersionMetadata, captureApiVersionMetadata, type RawPr, type RawPrReview } from './pr-snapshot'

export type SnapshotEvidenceStatus =
  | 'available'
  | 'partial'
  | 'not_found'
  | 'error'
  | 'skipped_rate_limit'
  | 'skipped_request_limit'

export type SnapshotEvidenceSource = 'snapshot' | 'github' | 'mixed'
export type SnapshotRetrievalStopReason = 'rate_limit' | 'request_limit' | 'not_found' | 'error'

const WORKFLOW_JOBS_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000

export interface SnapshotRequestBudget {
  limit: number
  attempted: number
}

export interface PullRequestSnapshotEvidence {
  status: SnapshotEvidenceStatus
  source: SnapshotEvidenceSource | null
  stoppedBy?: SnapshotRetrievalStopReason
  error: string | null
  fetchedAt: string | null
  pullRequest: RawPr | null
  reviews: RawPrReview[] | null
}

export interface WorkflowJobsSnapshotEvidence {
  status: SnapshotEvidenceStatus
  source: SnapshotEvidenceSource | null
  stoppedBy?: SnapshotRetrievalStopReason
  error: string | null
  fetchedAt: string | null
  jobs: RestEndpointMethodTypes['actions']['listJobsForWorkflowRun']['response']['data']['jobs'] | null
}

type PageResult<T> = {
  items: T[]
  pagesSucceeded: number
  stopReason: SnapshotRetrievalStopReason | null
  error: string | null
}

type PageResponse<T> = {
  data: T
  headers: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isRawPullRequest(value: unknown): value is RawPr {
  const pullRequest = asRecord(value)
  const head = asRecord(pullRequest?.head)
  const base = asRecord(pullRequest?.base)
  const baseRepository = asRecord(base?.repo)
  return (
    typeof pullRequest?.html_url === 'string' &&
    typeof pullRequest.title === 'string' &&
    typeof pullRequest.state === 'string' &&
    typeof pullRequest.created_at === 'string' &&
    typeof pullRequest.updated_at === 'string' &&
    typeof head?.sha === 'string' &&
    typeof base?.sha === 'string' &&
    typeof baseRepository?.id === 'number'
  )
}

function isRawReview(value: unknown): value is RawPrReview {
  const review = asRecord(value)
  return typeof review?.id === 'number' && typeof review.state === 'string'
}

function isWorkflowJobs(value: unknown): value is NonNullable<WorkflowJobsSnapshotEvidence['jobs']> {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      const job = asRecord(item)
      return (
        typeof job?.id === 'number' &&
        typeof job.name === 'string' &&
        typeof job.status === 'string' &&
        (job.steps === undefined || Array.isArray(job.steps))
      )
    })
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = asRecord(error)?.message
  return typeof message === 'string' ? message : 'GitHub request failed'
}

function errorStatus(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null
  const directStatus = 'status' in error ? error.status : null
  if (typeof directStatus === 'number') return directStatus
  const response = 'response' in error ? asRecord(error.response) : null
  return typeof response?.status === 'number' ? response.status : null
}

function rateLimitReached(): boolean {
  const remaining = getGitHubRateLimitRemaining()
  return remaining !== null && remaining < GITHUB_RATE_LIMIT_SAFETY_BUFFER
}

function snapshotDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function snapshotContainsAttempt(jobs: NonNullable<WorkflowJobsSnapshotEvidence['jobs']>, runAttempt: number): boolean {
  return jobs.some((job) => job.run_attempt === runAttempt)
}

function sourceFor(cached: boolean, fetched: boolean): SnapshotEvidenceSource | null {
  if (cached && fetched) return 'mixed'
  if (fetched) return 'github'
  if (cached) return 'snapshot'
  return null
}

async function fetchAllPages<T, TResponse>(
  fetchPage: (page: number) => Promise<PageResponse<TResponse>>,
  getItems: (data: TResponse) => T[],
  requestBudget: SnapshotRequestBudget,
  updateApiVersion: (headers: Record<string, unknown>) => void,
  isComplete?: (data: TResponse, itemCount: number) => boolean,
): Promise<PageResult<T>> {
  const items: T[] = []
  let pagesSucceeded = 0
  let page = 1
  while (true) {
    if (requestBudget.attempted >= requestBudget.limit) {
      return { items, pagesSucceeded, stopReason: 'request_limit', error: null }
    }
    if (rateLimitReached()) {
      return { items, pagesSucceeded, stopReason: 'rate_limit', error: null }
    }
    requestBudget.attempted++
    try {
      const response = await fetchPage(page)
      updateApiVersion(response.headers ?? {})
      const pageItems = getItems(response.data)
      pagesSucceeded++
      items.push(...pageItems)
      if (isComplete?.(response.data, items.length) ?? pageItems.length < 100) {
        return { items, pagesSucceeded, stopReason: null, error: null }
      }
      page++
    } catch (error) {
      const limited = getGitHubRateLimitError(error) !== null
      const status = errorStatus(error)
      return {
        items,
        pagesSucceeded,
        stopReason: limited ? 'rate_limit' : status === 404 || status === 410 ? 'not_found' : 'error',
        error: limited || status === 404 || status === 410 ? null : errorMessage(error),
      }
    }
  }
}

function failureStatus(stopReason: SnapshotRetrievalStopReason): SnapshotEvidenceStatus {
  if (stopReason === 'rate_limit') return 'skipped_rate_limit'
  if (stopReason === 'request_limit') return 'skipped_request_limit'
  if (stopReason === 'not_found') return 'not_found'
  return 'error'
}

function stopMessage(stopReason: SnapshotRetrievalStopReason): string {
  if (stopReason === 'rate_limit') return 'Rate limit prevented complete GitHub evidence retrieval'
  if (stopReason === 'request_limit') return 'Diagnostic request limit prevented complete GitHub evidence retrieval'
  if (stopReason === 'not_found') return 'GitHub no longer provides this evidence'
  return 'GitHub failed before complete evidence retrieval'
}

function repositoryIdentityMismatch(
  number: number,
  githubRepoId: number | string,
  actualRepoId: number,
): PullRequestSnapshotEvidence {
  return {
    status: 'error',
    source: null,
    stoppedBy: 'error',
    error: `Pull request ${number} belongs to GitHub repository ${actualRepoId}, not ${githubRepoId}`,
    fetchedAt: new Date().toISOString(),
    pullRequest: null,
    reviews: null,
  }
}

export async function getOrFetchPullRequestSnapshotEvidence(
  owner: string,
  repo: string,
  githubRepoId: number | string,
  number: number,
  requestBudget: SnapshotRequestBudget,
): Promise<PullRequestSnapshotEvidence> {
  let snapshots: Awaited<ReturnType<typeof getAllLatestPrRawSnapshotsByRepositoryId>>
  try {
    snapshots = await getAllLatestPrRawSnapshotsByRepositoryId(githubRepoId, number)
  } catch (error) {
    const message = errorMessage(error)
    logger.error('Could not read repository diagnostic pull request snapshots', {
      owner,
      repo,
      pull_request_number: number,
      error: message,
    })
    return {
      status: 'error',
      source: null,
      stoppedBy: 'error',
      error: message,
      fetchedAt: null,
      pullRequest: null,
      reviews: null,
    }
  }

  const prSnapshot = snapshots.get('pr')
  const reviewSnapshot = snapshots.get('reviews')
  let pullRequest = isRawPullRequest(prSnapshot?.data) ? prSnapshot.data : null
  let reviews =
    Array.isArray(reviewSnapshot?.data) && reviewSnapshot.data.every(isRawReview) ? reviewSnapshot.data : null
  const hasCachedPullRequest = pullRequest !== null
  const hasCachedReviews = reviews !== null
  let apiVersion: ApiVersionMetadata | null = null
  let fetchedFromGitHub = false
  let persistenceError: string | null = null
  const now = new Date().toISOString()

  if (pullRequest && String(pullRequest.base.repo.id) !== String(githubRepoId)) {
    const evidence = repositoryIdentityMismatch(number, githubRepoId, pullRequest.base.repo.id)
    logger.warn('Refusing repository diagnostic pull request from a different GitHub repository', {
      owner,
      repo,
      pull_request_number: number,
      expected_github_repo_id: String(githubRepoId),
      actual_github_repo_id: String(pullRequest.base.repo.id),
    })
    return evidence
  }

  if (pullRequest === null) {
    if (requestBudget.attempted >= requestBudget.limit || rateLimitReached()) {
      const stopReason = requestBudget.attempted >= requestBudget.limit ? 'request_limit' : 'rate_limit'
      return {
        status: failureStatus(stopReason),
        source: hasCachedReviews ? 'snapshot' : null,
        stoppedBy: stopReason,
        error: null,
        fetchedAt: reviewSnapshot ? snapshotDate(reviewSnapshot.fetchedAt) : null,
        pullRequest: null,
        reviews,
      }
    }
    try {
      requestBudget.attempted++
      const response = await getGitHubClient().pulls.get({ owner, repo, pull_number: number })
      apiVersion = captureApiVersionMetadata(response.headers ?? {}, apiVersion)
      if (String(response.data.base.repo.id) !== String(githubRepoId)) {
        logger.warn('Refusing repository diagnostic pull request from a different GitHub repository', {
          owner,
          repo,
          pull_request_number: number,
          expected_github_repo_id: String(githubRepoId),
          actual_github_repo_id: String(response.data.base.repo.id),
        })
        return repositoryIdentityMismatch(number, githubRepoId, response.data.base.repo.id)
      }
      pullRequest = response.data
      fetchedFromGitHub = true
      try {
        await savePrRawSnapshotsBatch(owner, repo, number, response.data.base.repo.id, apiVersion, [
          { dataType: 'pr', data: response.data },
        ])
      } catch (error) {
        persistenceError = errorMessage(error)
        logger.error('Could not persist repository diagnostic pull request snapshot', {
          owner,
          repo,
          pull_request_number: number,
          error: persistenceError,
        })
      }
    } catch (error) {
      const limited = getGitHubRateLimitError(error) !== null
      const stopReason = limited
        ? 'rate_limit'
        : errorStatus(error) === 404 || errorStatus(error) === 410
          ? 'not_found'
          : 'error'
      logger.warn('Could not fetch repository diagnostic pull request', {
        owner,
        repo,
        pull_request_number: number,
        error: errorMessage(error),
      })
      return {
        status: failureStatus(stopReason),
        source: hasCachedReviews ? 'snapshot' : null,
        stoppedBy: stopReason,
        error: limited || stopReason === 'not_found' ? null : errorMessage(error),
        fetchedAt: reviewSnapshot ? snapshotDate(reviewSnapshot.fetchedAt) : now,
        pullRequest: null,
        reviews,
      }
    }
  }

  if (reviews === null) {
    const reviewResult = await fetchAllPages(
      (page) => getGitHubClient().pulls.listReviews({ owner, repo, pull_number: number, per_page: 100, page }),
      (data) => data,
      requestBudget,
      (headers) => {
        apiVersion = captureApiVersionMetadata(headers, apiVersion)
      },
    )
    if (reviewResult.pagesSucceeded > 0) fetchedFromGitHub = true
    if (reviewResult.stopReason === null) {
      reviews = reviewResult.items
      fetchedFromGitHub = true
      try {
        const githubRepoId = pullRequest.base.repo.id
        await savePrRawSnapshotsBatch(
          owner,
          repo,
          number,
          githubRepoId,
          apiVersion ?? {
            apiVersion: 'unknown',
            apiDeprecatedAt: null,
            apiSunsetAt: null,
          },
          [{ dataType: 'reviews', data: reviews }],
        )
      } catch (error) {
        persistenceError = errorMessage(error)
        logger.error('Could not persist repository diagnostic pull request reviews snapshot', {
          owner,
          repo,
          pull_request_number: number,
          error: persistenceError,
        })
      }
    } else {
      logger.warn('Could not fetch complete repository diagnostic pull request reviews', {
        owner,
        repo,
        pull_request_number: number,
        ...(reviewResult.error && { error: reviewResult.error }),
        stop_reason: reviewResult.stopReason,
      })
      return {
        status: 'partial',
        source: sourceFor(hasCachedPullRequest || hasCachedReviews, fetchedFromGitHub),
        stoppedBy: reviewResult.stopReason,
        error: reviewResult.error ?? stopMessage(reviewResult.stopReason),
        fetchedAt:
          reviewResult.pagesSucceeded > 0 || fetchedFromGitHub
            ? now
            : prSnapshot
              ? snapshotDate(prSnapshot.fetchedAt)
              : now,
        pullRequest,
        reviews: reviewResult.pagesSucceeded === 0 ? [] : reviewResult.items,
      }
    }
  }

  const source = sourceFor(hasCachedPullRequest || hasCachedReviews, fetchedFromGitHub)
  const fetchedAt =
    source === 'snapshot'
      ? ([
          hasCachedPullRequest ? prSnapshot?.fetchedAt : undefined,
          hasCachedReviews ? reviewSnapshot?.fetchedAt : undefined,
        ]
          .filter((value): value is Date => value instanceof Date)
          .sort((left, right) => left.getTime() - right.getTime())[0]
          ?.toISOString() ?? null)
      : now
  return {
    status: persistenceError ? 'partial' : 'available',
    source,
    ...(persistenceError && { stoppedBy: 'error' as const }),
    error: persistenceError,
    fetchedAt,
    pullRequest,
    reviews,
  }
}

export async function getOrFetchWorkflowJobsSnapshotEvidence(
  owner: string,
  repo: string,
  githubRepoId: number | string,
  runId: number,
  attemptNumber: number | null,
  reuseSnapshot: boolean,
  requestBudget: SnapshotRequestBudget,
): Promise<WorkflowJobsSnapshotEvidence> {
  let snapshot: Awaited<ReturnType<typeof getLatestWorkflowJobsRawSnapshot>>
  try {
    snapshot = await getLatestWorkflowJobsRawSnapshot(githubRepoId, runId, attemptNumber)
  } catch (error) {
    const message = errorMessage(error)
    logger.error('Could not read repository diagnostic workflow job snapshot', {
      owner,
      repo,
      workflow_run_id: runId,
      attempt_number: attemptNumber,
      error: message,
    })
    return {
      status: 'error',
      source: null,
      stoppedBy: 'error',
      error: message,
      fetchedAt: null,
      jobs: null,
    }
  }

  const snapshotAgeMs = snapshot ? Date.now() - new Date(snapshot.fetchedAt).getTime() : Number.POSITIVE_INFINITY
  const workflowJobs = isWorkflowJobs(snapshot?.data) ? snapshot.data : null
  let canReuseSnapshot =
    reuseSnapshot && snapshotAgeMs >= 0 && snapshotAgeMs < WORKFLOW_JOBS_SNAPSHOT_MAX_AGE_MS && workflowJobs !== null
  if (canReuseSnapshot && workflowJobs !== null && snapshot && attemptNumber === null) {
    if (requestBudget.attempted >= requestBudget.limit || rateLimitReached()) {
      canReuseSnapshot = false
    } else {
      requestBudget.attempted++
      try {
        const currentRun = await getGitHubClient().actions.getWorkflowRun({
          owner,
          repo,
          run_id: runId,
        })
        canReuseSnapshot =
          currentRun.data.status === 'completed' &&
          String(currentRun.data.repository?.id) === String(githubRepoId) &&
          typeof currentRun.data.run_attempt === 'number' &&
          Number.isSafeInteger(currentRun.data.run_attempt) &&
          currentRun.data.run_attempt > 0 &&
          snapshotContainsAttempt(workflowJobs, currentRun.data.run_attempt)
      } catch (error) {
        logger.warn('Could not validate repository diagnostic workflow run before snapshot reuse', {
          owner,
          repo,
          workflow_run_id: runId,
          error: errorMessage(error),
        })
        canReuseSnapshot = false
      }
    }
  }
  if (canReuseSnapshot && workflowJobs !== null && snapshot) {
    return {
      status: 'available',
      source: 'snapshot',
      error: null,
      fetchedAt: snapshotDate(snapshot.fetchedAt),
      jobs: workflowJobs,
    }
  }

  const base = {
    source: null,
    fetchedAt: null,
    jobs: null,
  }
  if (requestBudget.attempted >= requestBudget.limit || rateLimitReached()) {
    const stopReason = requestBudget.attempted >= requestBudget.limit ? 'request_limit' : 'rate_limit'
    return {
      ...base,
      status: failureStatus(stopReason),
      stoppedBy: stopReason,
      error: null,
    }
  }

  let apiVersion: ApiVersionMetadata | null = null
  const jobResult = await fetchAllPages(
    (page) => {
      const request = { owner, repo, run_id: runId, per_page: 100 as const, page }
      return attemptNumber === null
        ? getGitHubClient().actions.listJobsForWorkflowRun({ ...request, filter: 'all' })
        : getGitHubClient().actions.listJobsForWorkflowRunAttempt({
            ...request,
            attempt_number: attemptNumber,
          })
    },
    (data) => data.jobs,
    requestBudget,
    (headers) => {
      apiVersion = captureApiVersionMetadata(headers, apiVersion)
    },
    (data, itemCount) => itemCount >= data.total_count,
  )
  if (jobResult.stopReason !== null) {
    logger.warn('Could not fetch complete repository diagnostic workflow jobs', {
      owner,
      repo,
      workflow_run_id: runId,
      attempt_number: attemptNumber,
      ...(jobResult.error && { error: jobResult.error }),
      stop_reason: jobResult.stopReason,
    })
    return {
      ...base,
      source: jobResult.pagesSucceeded > 0 ? 'github' : null,
      status: jobResult.pagesSucceeded > 0 ? 'partial' : failureStatus(jobResult.stopReason),
      stoppedBy: jobResult.stopReason,
      error: jobResult.error ?? (jobResult.pagesSucceeded === 0 ? null : stopMessage(jobResult.stopReason)),
      fetchedAt: new Date().toISOString(),
      jobs: jobResult.pagesSucceeded === 0 ? null : jobResult.items,
    }
  }

  const fetchedAt = new Date().toISOString()
  try {
    const storedApiVersion = apiVersion ?? {
      apiVersion: 'unknown',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
    }
    await saveWorkflowJobsRawSnapshot(
      owner,
      repo,
      githubRepoId,
      runId,
      attemptNumber,
      jobResult.items,
      storedApiVersion,
    )
    return {
      status: 'available',
      source: 'github',
      error: null,
      fetchedAt,
      jobs: jobResult.items,
    }
  } catch (error) {
    const message = errorMessage(error)
    logger.error('Could not persist repository diagnostic workflow job snapshot', {
      owner,
      repo,
      workflow_run_id: runId,
      attempt_number: attemptNumber,
      error: message,
    })
    return {
      status: 'partial',
      source: 'github',
      stoppedBy: 'error',
      error: message,
      fetchedAt,
      jobs: jobResult.items,
    }
  }
}
