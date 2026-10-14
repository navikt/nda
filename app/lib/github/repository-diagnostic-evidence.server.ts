import type {
  RepositoryCodeDeliveryExportRow,
  RepositoryCodeDeliveryRepositoryAlias,
  RepositoryGitHubPrSnapshotExportRow,
  RepositoryVerificationRunExportRow,
  RepositoryWorkflowRunSnapshotExportRow,
} from '~/db/repository-code-delivery-overview.server'
import {
  getOrFetchPullRequestSnapshotEvidence,
  getOrFetchWorkflowJobsSnapshotEvidence,
  type SnapshotEvidenceSource,
  type SnapshotEvidenceStatus,
  type SnapshotRequestBudget,
  type SnapshotRetrievalStopReason,
} from './diagnostic-evidence-snapshots.server'
import { parseWorkflowRunUrl } from './git.server'

type EvidenceStatus = SnapshotEvidenceStatus
type RetrievalStopReason = SnapshotRetrievalStopReason

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
  source: SnapshotEvidenceSource | null
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
  source: SnapshotEvidenceSource | null
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
  githubRepoId: number | string
  repositoryAliases: RepositoryCodeDeliveryRepositoryAlias[]
  deployments: RepositoryCodeDeliveryExportRow[]
  verificationRuns: RepositoryVerificationRunExportRow[]
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[]
  workflowRunSnapshots: RepositoryWorkflowRunSnapshotExportRow[]
}

type RequestBudget = SnapshotRequestBudget

type WorkflowRunGroup = {
  runId: string
  owner: string
  repo: string
  attemptNumber: number | null
  githubRepoId: number | string
  workflowRunStatus: string | null
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

async function fetchPullRequestEvidence(
  owner: string,
  repo: string,
  number: number,
  references: PullRequestReference[],
  requestBudget: RequestBudget,
): Promise<RepositoryDiagnosticPullRequestEvidence> {
  const evidence = await getOrFetchPullRequestSnapshotEvidence(owner, repo, number, requestBudget)
  const pullRequest = evidence.pullRequest
  return {
    number,
    references,
    status: evidence.status,
    source: evidence.source,
    ...(evidence.stoppedBy && { stoppedBy: evidence.stoppedBy }),
    error: evidence.error,
    fetchedAt: evidence.fetchedAt,
    pullRequest: pullRequest
      ? {
          htmlUrl: pullRequest.html_url,
          title: pullRequest.title,
          state: pullRequest.state,
          createdAt: pullRequest.created_at,
          updatedAt: pullRequest.updated_at,
          closedAt: pullRequest.closed_at,
          mergedAt: pullRequest.merged_at,
          mergeCommitSha: pullRequest.merge_commit_sha,
          mergedBy: pullRequest.merged_by?.login ?? null,
          headSha: pullRequest.head.sha,
          baseSha: pullRequest.base.sha,
        }
      : null,
    reviews:
      evidence.reviews?.map((review) => ({
        id: review.id,
        reviewer: review.user?.login ?? null,
        state: review.state,
        submittedAt: review.submitted_at ?? null,
        commitSha: review.commit_id,
        htmlUrl: review.html_url,
      })) ?? null,
  }
}

async function fetchWorkflowEvidence(
  snapshotGroup: WorkflowRunGroup,
  requestBudget: RequestBudget,
): Promise<RepositoryDiagnosticWorkflowEvidence> {
  const { runId, owner, repo, attemptNumber, snapshotIds, deploymentIds, githubRepoId } = snapshotGroup
  const evidence = await getOrFetchWorkflowJobsSnapshotEvidence(
    owner,
    repo,
    githubRepoId,
    Number(runId),
    attemptNumber,
    snapshotGroup.workflowRunStatus === 'completed',
    requestBudget,
  )
  return {
    runId,
    owner,
    repo,
    attemptNumber,
    snapshotIds,
    deploymentIds,
    status: evidence.status,
    source: evidence.source,
    ...(evidence.stoppedBy && { stoppedBy: evidence.stoppedBy }),
    error: evidence.error,
    fetchedAt: evidence.fetchedAt,
    jobs:
      evidence.jobs?.map((job) => ({
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
      })) ?? null,
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
        githubRepoId: input.githubRepoId,
        workflowRunStatus: null,
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
                githubRepoId: input.githubRepoId,
                workflowRunStatus: null,
                snapshotIds: [],
                deploymentIds: [],
              },
            ],
          ]
    for (const [key, group] of groupsToUpdate) {
      if (!group.snapshotIds.includes(snapshot.id)) group.snapshotIds.push(snapshot.id)
      const snapshotData = asRecord(snapshot.data)
      group.workflowRunStatus = typeof snapshotData?.status === 'string' ? snapshotData.status : null
      workflowGroups.set(key, group)
    }
  }

  const pullRequests: RepositoryDiagnosticPullRequestEvidence[] = []
  const workflowRuns: RepositoryDiagnosticWorkflowEvidence[] = []
  let rateLimited = false
  let requestLimited = false

  for (const [number, references] of prReferences) {
    const evidence = await fetchPullRequestEvidence(input.owner, input.repo, number, references, requestBudget)
    pullRequests.push(evidence)
    if (evidence.status === 'skipped_rate_limit' || evidence.stoppedBy === 'rate_limit') rateLimited = true
    if (evidence.status === 'skipped_request_limit' || evidence.stoppedBy === 'request_limit') requestLimited = true
  }

  for (const group of workflowGroups.values()) {
    const evidence = await fetchWorkflowEvidence(group, requestBudget)
    workflowRuns.push(evidence)
    if (evidence.status === 'skipped_rate_limit' || evidence.stoppedBy === 'rate_limit') rateLimited = true
    if (evidence.status === 'skipped_request_limit' || evidence.stoppedBy === 'request_limit') requestLimited = true
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
