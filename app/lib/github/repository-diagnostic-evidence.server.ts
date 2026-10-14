import type {
  RepositoryCodeDeliveryExportRow,
  RepositoryCodeDeliveryRepositoryAlias,
  RepositoryGitHubPrSnapshotExportRow,
  RepositoryVerificationRunExportRow,
  RepositoryWorkflowRunSnapshotExportRow,
} from '~/db/repository-code-delivery-overview.server'
import { logger } from '~/lib/logger.server'
import {
  GITHUB_RATE_LIMIT_SAFETY_BUFFER,
  getGitHubClient,
  getGitHubRateLimitError,
  getGitHubRateLimitRemaining,
} from './client.server'
import { parseWorkflowRunUrl } from './git.server'

type EvidenceStatus = 'available' | 'partial' | 'not_found' | 'error' | 'skipped_rate_limit' | 'skipped_request_limit'
type RetrievalStopReason = 'rate_limit' | 'request_limit' | 'not_found' | 'error'

type PullRequestReference = {
  type: string
  deploymentId?: number
  snapshotId?: number
  workflowRunId?: string
}

interface RepositoryDiagnosticPullRequestEvidence {
  number: number
  references: PullRequestReference[]
  status: EvidenceStatus
  stoppedBy?: RetrievalStopReason
  error: string | null
  fetchedAt: string | null
  pullRequest: {
    htmlUrl: string
    title: string
    state: string
    createdAt: string
    updatedAt: string
    closedAt: string | null
    mergedAt: string | null
    mergeCommitSha: string | null
    mergedBy: string | null
    headSha: string
    baseSha: string
  } | null
  reviews: Array<{
    id: number
    reviewer: string | null
    state: string
    submittedAt: string | null
    commitSha: string | null
    htmlUrl: string | null
  }> | null
}

interface RepositoryDiagnosticWorkflowEvidence {
  runId: string
  owner: string
  repo: string
  attemptNumber: number | null
  snapshotIds: number[]
  deploymentIds: number[]
  status: EvidenceStatus
  stoppedBy?: RetrievalStopReason
  error: string | null
  fetchedAt: string | null
  jobs: Array<{
    id: number
    name: string
    runAttempt: number | null
    status: string
    conclusion: string | null
    startedAt: string | null
    completedAt: string | null
    htmlUrl: string | null
    steps: Array<{
      name: string
      status: string
      conclusion: string | null
      number: number
      startedAt: string | null
      completedAt: string | null
    }>
  }> | null
}

export interface RepositoryDiagnosticGitHubEvidence {
  fetchedAt: string
  status: 'complete' | 'partial' | 'rate_limited' | 'request_limited' | 'not_needed'
  requestLimit: number
  requestsAttempted: number
  pullRequests: RepositoryDiagnosticPullRequestEvidence[]
  workflowRuns: RepositoryDiagnosticWorkflowEvidence[]
}

type EvidenceInputs = {
  owner: string
  repo: string
  repositoryAliases: RepositoryCodeDeliveryRepositoryAlias[]
  deployments: RepositoryCodeDeliveryExportRow[]
  verificationRuns: RepositoryVerificationRunExportRow[]
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[]
  workflowRunSnapshots: RepositoryWorkflowRunSnapshotExportRow[]
}

type RequestBudget = {
  limit: number
  attempted: number
}

type WorkflowRunGroup = {
  runId: string
  owner: string
  repo: string
  attemptNumber: number | null
  snapshotIds: number[]
  deploymentIds: number[]
}

const DIAGNOSTIC_GITHUB_REQUEST_LIMIT = 100

function parseWorkflowRunEvidenceUrl(
  triggerUrl: string | null | undefined,
  owner: string,
  repo: string,
): { runId: number; attemptNumber: number | null } | null {
  const run = parseWorkflowRunUrl(triggerUrl, owner, repo)
  if (run === null) return null

  const attemptMatch = triggerUrl?.match(
    /^https:\/\/github[.]com\/[^/?#]+\/[^/?#]+\/actions\/runs\/([0-9]+)\/attempts\/([0-9]+)(?:[/?#].*)?$/i,
  )
  const attemptNumber = attemptMatch && Number(attemptMatch[1]) === run.runId ? Number(attemptMatch[2]) : Number.NaN
  return {
    runId: run.runId,
    attemptNumber: Number.isSafeInteger(attemptNumber) && attemptNumber > 0 ? attemptNumber : null,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function addPrReference(
  references: Map<number, PullRequestReference[]>,
  prNumber: number,
  reference: PullRequestReference,
): void {
  const current = references.get(prNumber) ?? []
  if (
    !current.some(
      (existing) =>
        existing.type === reference.type &&
        existing.deploymentId === reference.deploymentId &&
        existing.snapshotId === reference.snapshotId &&
        existing.workflowRunId === reference.workflowRunId,
    )
  ) {
    current.push(reference)
  }
  references.set(prNumber, current)
}

function discoverPullRequestReferences(
  deployments: RepositoryCodeDeliveryExportRow[],
  verificationRuns: RepositoryVerificationRunExportRow[],
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[],
  workflowRunSnapshots: RepositoryWorkflowRunSnapshotExportRow[],
): Map<number, PullRequestReference[]> {
  const references = new Map<number, PullRequestReference[]>()
  const prSnapshotsById = new Map(prSnapshots.map((snapshot) => [snapshot.id, snapshot]))
  for (const deployment of deployments) {
    const prNumber = positiveInteger(deployment.github_pr_number)
    if (prNumber !== null) {
      addPrReference(references, prNumber, {
        type: 'deployment_github_pr_number',
        deploymentId: deployment.deployment_id,
      })
    }
  }

  for (const run of verificationRuns) {
    const result = asRecord(run.result)
    const deployedPr = asRecord(result?.deployedPr)
    const deployedPrNumber = positiveInteger(deployedPr?.number)
    if (deployedPrNumber !== null) {
      addPrReference(references, deployedPrNumber, {
        type: 'verification_deployed_pr',
        deploymentId: run.deployment_id,
      })
    }

    const unverifiedCommits = Array.isArray(result?.unverifiedCommits) ? result.unverifiedCommits : []
    for (const commit of unverifiedCommits) {
      const prNumber = positiveInteger(asRecord(commit)?.prNumber)
      if (prNumber !== null) {
        addPrReference(references, prNumber, {
          type: 'verification_unverified_commit',
          deploymentId: run.deployment_id,
        })
      }
    }
    const branchMismatch = asRecord(result?.branchMismatch)
    const mismatchedPrNumbers = Array.isArray(branchMismatch?.prNumbers) ? branchMismatch.prNumbers : []
    for (const value of mismatchedPrNumbers) {
      const prNumber = positiveInteger(value)
      if (prNumber !== null) {
        addPrReference(references, prNumber, {
          type: 'verification_branch_mismatch',
          deploymentId: run.deployment_id,
        })
      }
    }
    for (const snapshotId of run.pr_snapshot_ids) {
      const snapshot = prSnapshotsById.get(snapshotId)
      if (snapshot) {
        addPrReference(references, snapshot.pr_number, {
          type: 'verification_pr_snapshot',
          deploymentId: run.deployment_id,
          snapshotId,
        })
      }
    }
  }

  for (const snapshot of workflowRunSnapshots) {
    const data = asRecord(snapshot.data)
    const runId = snapshot.run_id
    const pullRequests = Array.isArray(data?.pull_requests) ? data.pull_requests : []
    for (const pullRequest of pullRequests) {
      const prNumber = positiveInteger(asRecord(pullRequest)?.number)
      if (prNumber !== null) {
        addPrReference(references, prNumber, {
          type: 'workflow_run_pull_request',
          workflowRunId: runId,
        })
      }
    }

    const displayTitle = typeof data?.display_title === 'string' ? data.display_title : ''
    for (const match of displayTitle.matchAll(/(?:\(#|pull request #)(\d+)\)?/gi)) {
      const prNumber = Number(match[1])
      if (Number.isSafeInteger(prNumber) && prNumber > 0) {
        addPrReference(references, prNumber, {
          type: 'workflow_run_title',
          workflowRunId: runId,
        })
      }
    }
  }
  return references
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

async function fetchAllPages<T, TResponse>(
  fetchPage: (page: number) => Promise<{ data: TResponse }>,
  getItems: (data: TResponse) => T[],
  requestBudget: RequestBudget,
  isComplete?: (data: TResponse, itemCount: number) => boolean,
): Promise<{ items: T[]; pagesSucceeded: number; stopReason: RetrievalStopReason | null; error: string | null }> {
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

async function fetchPullRequestEvidence(
  owner: string,
  repo: string,
  number: number,
  references: PullRequestReference[],
  requestBudget: RequestBudget,
): Promise<RepositoryDiagnosticPullRequestEvidence> {
  const base = {
    number,
    references,
    fetchedAt: null,
    pullRequest: null,
    reviews: null,
  }
  if (requestBudget.attempted >= requestBudget.limit) {
    return { ...base, status: 'skipped_request_limit', stoppedBy: 'request_limit', error: null }
  }
  if (rateLimitReached()) {
    return { ...base, status: 'skipped_rate_limit', stoppedBy: 'rate_limit', error: null }
  }

  const fetchedAt = new Date().toISOString()
  let client: ReturnType<typeof getGitHubClient>
  let pullRequest: RepositoryDiagnosticPullRequestEvidence['pullRequest']
  try {
    requestBudget.attempted++
    client = getGitHubClient()
    const response = await client.pulls.get({ owner, repo, pull_number: number })
    pullRequest = {
      htmlUrl: response.data.html_url,
      title: response.data.title,
      state: response.data.state,
      createdAt: response.data.created_at,
      updatedAt: response.data.updated_at,
      closedAt: response.data.closed_at,
      mergedAt: response.data.merged_at,
      mergeCommitSha: response.data.merge_commit_sha,
      mergedBy: response.data.merged_by?.login ?? null,
      headSha: response.data.head.sha,
      baseSha: response.data.base.sha,
    }
  } catch (error) {
    const limited = getGitHubRateLimitError(error) !== null
    logger.warn('Could not fetch repository diagnostic pull request', {
      owner,
      repo,
      pull_request_number: number,
      error: errorMessage(error),
    })
    return {
      ...base,
      fetchedAt,
      status: limited
        ? 'skipped_rate_limit'
        : errorStatus(error) === 404 || errorStatus(error) === 410
          ? 'not_found'
          : 'error',
      stoppedBy: limited
        ? 'rate_limit'
        : errorStatus(error) === 404 || errorStatus(error) === 410
          ? 'not_found'
          : 'error',
      error: limited || errorStatus(error) === 404 || errorStatus(error) === 410 ? null : errorMessage(error),
    }
  }

  const reviewResult = await fetchAllPages(
    (page) => client.pulls.listReviews({ owner, repo, pull_number: number, per_page: 100, page }),
    (data) => data,
    requestBudget,
  )
  if (reviewResult.stopReason === null) {
    return {
      ...base,
      fetchedAt,
      pullRequest,
      status: 'available',
      error: null,
      reviews: reviewResult.items.map((review) => ({
        id: review.id,
        reviewer: review.user?.login ?? null,
        state: review.state,
        submittedAt: review.submitted_at ?? null,
        commitSha: review.commit_id,
        htmlUrl: review.html_url,
      })),
    }
  } else if (reviewResult.pagesSucceeded > 0) {
    logger.warn('Could not fetch repository diagnostic pull request reviews', {
      owner,
      repo,
      pull_request_number: number,
      ...(reviewResult.error && { error: reviewResult.error }),
      stop_reason: reviewResult.stopReason,
    })
    return {
      ...base,
      fetchedAt,
      pullRequest,
      status: 'partial',
      stoppedBy: reviewResult.stopReason,
      error:
        reviewResult.error ??
        (reviewResult.stopReason === 'rate_limit'
          ? 'Rate limit prevented review retrieval'
          : reviewResult.stopReason === 'request_limit'
            ? 'Diagnostic request limit prevented complete review retrieval'
            : reviewResult.stopReason === 'not_found'
              ? 'GitHub no longer provides the complete review history'
              : 'GitHub failed before complete review retrieval'),
      reviews: reviewResult.items.map((review) => ({
        id: review.id,
        reviewer: review.user?.login ?? null,
        state: review.state,
        submittedAt: review.submitted_at ?? null,
        commitSha: review.commit_id,
        htmlUrl: review.html_url,
      })),
    }
  } else {
    return {
      ...base,
      fetchedAt,
      pullRequest,
      status: 'partial',
      stoppedBy: reviewResult.stopReason,
      error:
        reviewResult.error ??
        (reviewResult.stopReason === 'rate_limit'
          ? 'Rate limit prevented review retrieval'
          : reviewResult.stopReason === 'request_limit'
            ? 'Diagnostic request limit prevented review retrieval'
            : reviewResult.stopReason === 'not_found'
              ? 'GitHub no longer provides this review history'
              : 'GitHub failed before review history was retrieved'),
      reviews: [],
    }
  }
}

async function fetchWorkflowEvidence(
  snapshotGroup: WorkflowRunGroup,
  requestBudget: RequestBudget,
): Promise<RepositoryDiagnosticWorkflowEvidence> {
  const { runId, owner, repo, attemptNumber, snapshotIds, deploymentIds } = snapshotGroup
  const base = { runId, owner, repo, attemptNumber, snapshotIds, deploymentIds, fetchedAt: null, jobs: null }
  if (requestBudget.attempted >= requestBudget.limit) {
    return { ...base, status: 'skipped_request_limit', stoppedBy: 'request_limit', error: null }
  }
  if (rateLimitReached()) {
    return { ...base, status: 'skipped_rate_limit', stoppedBy: 'rate_limit', error: null }
  }

  const fetchedAt = new Date().toISOString()
  try {
    const client = getGitHubClient()
    const jobResult = await fetchAllPages(
      (page) => {
        const request = {
          owner,
          repo,
          run_id: Number(runId),
          per_page: 100 as const,
          page,
        }
        return attemptNumber === null
          ? client.actions.listJobsForWorkflowRun({ ...request, filter: 'all' })
          : client.actions.listJobsForWorkflowRunAttempt({
              ...request,
              attempt_number: attemptNumber,
            })
      },
      (data) => data.jobs,
      requestBudget,
      (data, itemCount) => itemCount >= data.total_count,
    )
    if (jobResult.stopReason !== null) {
      logger.warn('Could not fetch complete repository diagnostic workflow jobs', {
        owner,
        repo,
        workflow_run_id: runId,
        ...(jobResult.error && { error: jobResult.error }),
        stop_reason: jobResult.stopReason,
      })
      return {
        ...base,
        fetchedAt,
        status:
          jobResult.pagesSucceeded > 0
            ? 'partial'
            : jobResult.stopReason === 'rate_limit'
              ? 'skipped_rate_limit'
              : jobResult.stopReason === 'request_limit'
                ? 'skipped_request_limit'
                : jobResult.stopReason,
        stoppedBy: jobResult.stopReason,
        error:
          jobResult.error ??
          (jobResult.pagesSucceeded === 0 && jobResult.stopReason !== 'error'
            ? null
            : jobResult.stopReason === 'rate_limit'
              ? 'Rate limit prevented workflow job retrieval'
              : jobResult.stopReason === 'request_limit'
                ? 'Diagnostic request limit prevented complete workflow job retrieval'
                : jobResult.stopReason === 'not_found'
                  ? 'GitHub no longer provides this workflow run'
                  : 'GitHub failed before workflow job retrieval'),
        jobs:
          jobResult.pagesSucceeded === 0
            ? null
            : jobResult.items.map((job) => ({
                id: job.id,
                name: job.name,
                runAttempt: job.run_attempt ?? null,
                status: job.status,
                conclusion: job.conclusion,
                startedAt: job.started_at ?? null,
                completedAt: job.completed_at,
                htmlUrl: job.html_url,
                steps: (job.steps ?? []).map((step) => ({
                  name: step.name,
                  status: step.status,
                  conclusion: step.conclusion,
                  number: step.number,
                  startedAt: step.started_at ?? null,
                  completedAt: step.completed_at ?? null,
                })),
              })),
      }
    }
    const jobs = jobResult.items
    return {
      ...base,
      fetchedAt,
      status: 'available',
      error: null,
      jobs: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        runAttempt: job.run_attempt ?? null,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at ?? null,
        completedAt: job.completed_at,
        htmlUrl: job.html_url,
        steps: (job.steps ?? []).map((step) => ({
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
          number: step.number,
          startedAt: step.started_at ?? null,
          completedAt: step.completed_at ?? null,
        })),
      })),
    }
  } catch (error) {
    const limited = getGitHubRateLimitError(error) !== null
    logger.warn('Could not fetch repository diagnostic workflow jobs', {
      owner,
      repo,
      workflow_run_id: runId,
      error: errorMessage(error),
    })
    return {
      ...base,
      fetchedAt,
      status: limited
        ? 'skipped_rate_limit'
        : errorStatus(error) === 404 || errorStatus(error) === 410
          ? 'not_found'
          : 'error',
      stoppedBy: limited
        ? 'rate_limit'
        : errorStatus(error) === 404 || errorStatus(error) === 410
          ? 'not_found'
          : 'error',
      error: limited || errorStatus(error) === 404 || errorStatus(error) === 410 ? null : errorMessage(error),
    }
  }
}

export async function fetchRepositoryDiagnosticGitHubEvidence(
  input: EvidenceInputs,
): Promise<RepositoryDiagnosticGitHubEvidence> {
  const fetchedAt = new Date().toISOString()
  const requestBudget: RequestBudget = { limit: DIAGNOSTIC_GITHUB_REQUEST_LIMIT, attempted: 0 }
  const prReferences = discoverPullRequestReferences(
    input.deployments,
    input.verificationRuns,
    input.prSnapshots,
    input.workflowRunSnapshots,
  )
  const workflowGroups = new Map<string, WorkflowRunGroup>()

  for (const deployment of input.deployments) {
    const workflowRun =
      parseWorkflowRunEvidenceUrl(deployment.trigger_url, input.owner, input.repo) ??
      input.repositoryAliases
        .map((alias) => parseWorkflowRunEvidenceUrl(deployment.trigger_url, alias.owner, alias.repo))
        .find((candidate) => candidate !== null) ??
      null
    if (workflowRun !== null) {
      const key = `${workflowRun.runId}:${workflowRun.attemptNumber ?? 'all'}`
      const group = workflowGroups.get(key) ?? {
        runId: String(workflowRun.runId),
        owner: input.owner,
        repo: input.repo,
        attemptNumber: workflowRun.attemptNumber,
        snapshotIds: [],
        deploymentIds: [],
      }
      if (!group.deploymentIds.includes(deployment.deployment_id)) {
        group.deploymentIds.push(deployment.deployment_id)
      }
      workflowGroups.set(key, group)
    }
  }

  for (const snapshot of input.workflowRunSnapshots) {
    const numericRunId = Number(snapshot.run_id)
    if (!Number.isSafeInteger(numericRunId) || numericRunId <= 0) continue
    const matchingGroups = [...workflowGroups.entries()].filter(([, group]) => group.runId === snapshot.run_id)
    const groupsToUpdate: Array<[string, WorkflowRunGroup]> =
      matchingGroups.length > 0
        ? matchingGroups
        : [
            [
              `${snapshot.run_id}:all`,
              {
                runId: snapshot.run_id,
                owner: input.owner,
                repo: input.repo,
                attemptNumber: null,
                snapshotIds: [],
                deploymentIds: [],
              },
            ],
          ]
    for (const [key, group] of groupsToUpdate) {
      if (!group.snapshotIds.includes(snapshot.id)) group.snapshotIds.push(snapshot.id)
      workflowGroups.set(key, group)
    }
  }

  const pullRequests: RepositoryDiagnosticPullRequestEvidence[] = []
  const workflowRuns: RepositoryDiagnosticWorkflowEvidence[] = []
  let rateLimited = false
  let requestLimited = false

  for (const [number, references] of prReferences) {
    const evidence =
      rateLimited || requestLimited
        ? {
            number,
            references,
            status: rateLimited ? ('skipped_rate_limit' as const) : ('skipped_request_limit' as const),
            error: null,
            fetchedAt: null,
            pullRequest: null,
            reviews: null,
          }
        : await fetchPullRequestEvidence(input.owner, input.repo, number, references, requestBudget)
    pullRequests.push(evidence)
    if (evidence.stoppedBy === 'rate_limit') rateLimited = true
    if (evidence.stoppedBy === 'request_limit') requestLimited = true
  }

  for (const group of workflowGroups.values()) {
    const evidence =
      rateLimited || requestLimited
        ? {
            ...group,
            status: rateLimited ? ('skipped_rate_limit' as const) : ('skipped_request_limit' as const),
            error: null,
            fetchedAt: null,
            jobs: null,
          }
        : await fetchWorkflowEvidence(group, requestBudget)
    workflowRuns.push(evidence)
    if (evidence.stoppedBy === 'rate_limit') rateLimited = true
    if (evidence.stoppedBy === 'request_limit') requestLimited = true
  }

  const failed = [...pullRequests, ...workflowRuns].some(
    (evidence) => evidence.status === 'error' || evidence.status === 'partial' || evidence.status === 'not_found',
  )
  const status =
    pullRequests.length === 0 && workflowRuns.length === 0
      ? 'not_needed'
      : rateLimited
        ? 'rate_limited'
        : requestLimited
          ? 'request_limited'
          : failed
            ? 'partial'
            : 'complete'

  return {
    fetchedAt,
    status,
    requestLimit: requestBudget.limit,
    requestsAttempted: requestBudget.attempted,
    pullRequests,
    workflowRuns,
  }
}
