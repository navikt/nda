import {
  getWorkflowRunRawSnapshotData,
  hasRecentWorkflowRunAttemptShaFailure,
  recordWorkflowRunAttemptShaFailure,
  saveCommitRawSnapshot,
  saveCompareRawSnapshot,
  saveWorkflowRunRawSnapshot,
} from '~/db/github-data.server'
import { logger } from '~/lib/logger.server'
import type { CompareData } from '~/lib/verification/types'
import {
  GITHUB_RATE_LIMIT_SAFETY_BUFFER,
  getGitHubClient,
  getGitHubRateLimitError,
  getGitHubRateLimitRemaining,
} from './client.server'
import { mapCompareResponse, type RawCompareResponse } from './compare-snapshot'
import { type ApiVersionMetadata, captureApiVersionMetadata } from './pr-snapshot'

export async function getCommitsBetween(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<{
  compareData: CompareData
  rawData: RawCompareResponse
  apiVersion: ApiVersionMetadata
  githubRepoId: number
} | null> {
  try {
    const client = getGitHubClient()

    logger.info(`🔍 Comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)} in ${owner}/${repo}`)

    const [response, repoResponse] = await Promise.all([
      client.repos.compareCommits({
        owner,
        repo,
        base,
        head,
      }),
      client.repos.get({ owner, repo }),
    ])

    logger.info(`   📊 GitHub API response:`)
    logger.info(`      - Status: ${response.data.status}`)
    logger.info(`      - Ahead by: ${response.data.ahead_by} commits`)
    logger.info(`      - Behind by: ${response.data.behind_by} commits`)
    logger.info(`      - Total commits: ${response.data.total_commits}`)

    logger.info(`      - Commits array length: ${(response.data.commits || []).length}`)
    logger.info(`      - Files array length: ${(response.data.files || []).length}`)

    const compareData = mapCompareResponse(response.data)
    const { commits } = compareData

    logger.info(`✅ Found ${commits.length} commit(s) between ${base.substring(0, 7)} and ${head.substring(0, 7)}`)

    if (commits.length > 0 && commits.length <= 10) {
      logger.info(`   📝 Commits:`)
      commits.forEach((c, idx) => {
        logger.info(
          `      ${idx + 1}. ${c.sha.substring(0, 7)} by ${c.authorUsername}: ${c.message.split('\n')[0].substring(0, 50)}`,
        )
      })
    }

    const apiVersion = captureApiVersionMetadata(response.headers, null)

    return { compareData, rawData: response.data, apiVersion, githubRepoId: repoResponse.data.id }
  } catch (error) {
    logger.error(`❌ Error comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)}:`, error)
    return null
  }
}

export async function haveSameCommitTree(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
): Promise<boolean | null> {
  try {
    const client = getGitHubClient()

    const [baseCommit, headCommit] = await Promise.all([
      client.repos.getCommit({ owner, repo, ref: baseSha }),
      client.repos.getCommit({ owner, repo, ref: headSha }),
    ])

    await Promise.all([
      archiveCommitRawSnapshot(owner, repo, baseSha, baseCommit.data, baseCommit.headers),
      archiveCommitRawSnapshot(owner, repo, headSha, headCommit.data, headCommit.headers),
    ])

    return baseCommit.data.commit.tree?.sha === headCommit.data.commit.tree?.sha
  } catch (error) {
    logger.warn(
      `⚠️ Failed to compare commit trees for ${baseSha.substring(0, 7)}...${headSha.substring(0, 7)} in ${owner}/${repo}:`,
      error as Record<string, unknown>,
    )
    return null
  }
}

export async function archiveCommitRawSnapshot(
  owner: string,
  repo: string,
  sha: string,
  data: unknown,
  headers: Record<string, unknown>,
): Promise<void> {
  try {
    const githubRepoId = await getRepositoryId(owner, repo)
    if (githubRepoId === null) return
    const apiVersion = captureApiVersionMetadata(headers, null)
    await saveCommitRawSnapshot(owner, repo, githubRepoId, sha, data, apiVersion)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`⚠️ Failed to archive commit ${sha.substring(0, 7)} for ${owner}/${repo}:`, { error: message })
  }
}

type CommitAncestryStatus = 'identical' | 'ahead' | 'behind' | 'diverged'

export async function getCommitAncestryStatus(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  knownGithubRepoId?: number,
): Promise<CommitAncestryStatus | null> {
  try {
    const client = getGitHubClient()

    const response = await client.repos.compareCommits({
      owner,
      repo,
      base: baseSha,
      head: headSha,
    })

    await archiveCompareRawSnapshot(owner, repo, baseSha, headSha, response.data, response.headers, knownGithubRepoId)

    return response.data.status as CommitAncestryStatus
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      `⚠️ Failed to compare commit ancestry ${baseSha.substring(0, 7)}...${headSha.substring(0, 7)} in ${owner}/${repo}:`,
      { error: message },
    )
    return null
  }
}

async function archiveCompareRawSnapshot(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string,
  data: unknown,
  headers: Record<string, unknown>,
  knownGithubRepoId?: number,
): Promise<void> {
  try {
    const githubRepoId = knownGithubRepoId ?? (await getRepositoryId(owner, repo))
    if (githubRepoId === null) return
    const apiVersion = captureApiVersionMetadata(headers, null)
    await saveCompareRawSnapshot(owner, repo, githubRepoId, baseSha, headSha, data, apiVersion)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      `⚠️ Failed to archive compare snapshot ${baseSha.substring(0, 7)}...${headSha.substring(0, 7)} for ${owner}/${repo}:`,
      {
        error: message,
      },
    )
  }
}

export async function isCommitOnBranch(
  owner: string,
  repo: string,
  commitSha: string,
  branch: string,
): Promise<boolean | null> {
  try {
    const client = getGitHubClient()

    const response = await client.repos.compareCommits({
      owner,
      repo,
      base: commitSha,
      head: branch,
    })

    const status = response.data.status
    return status === 'identical' || status === 'ahead'
  } catch (error) {
    logger.warn(
      `⚠️ Failed to check if ${commitSha.substring(0, 7)} is on ${branch} in ${owner}/${repo}:`,
      error as Record<string, unknown>,
    )
    return null
  }
}

export async function getSingleCommitMessage(owner: string, repo: string, commitSha: string): Promise<string | null> {
  try {
    const client = getGitHubClient()
    const response = await client.repos.getCommit({ owner, repo, ref: commitSha })
    await archiveCommitRawSnapshot(owner, repo, commitSha, response.data, response.headers)
    return response.data.commit.message || null
  } catch (error) {
    logger.warn(
      `⚠️ Failed to fetch commit message for ${commitSha.substring(0, 7)} in ${owner}/${repo}:`,
      error as Record<string, unknown>,
    )
    return null
  }
}

type WorkflowRunData = Awaited<ReturnType<ReturnType<typeof getGitHubClient>['actions']['getWorkflowRun']>>['data']

async function resolveWorkflowRun(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
): Promise<WorkflowRunData | null> {
  const match = triggerUrl?.match(/\/actions\/runs\/(\d+)/)
  if (!match) return null
  const runId = parseInt(match[1], 10)
  try {
    const client = getGitHubClient()
    const response = await client.actions.getWorkflowRun({ owner, repo, run_id: runId })
    await archiveWorkflowRunRawSnapshot(owner, repo, runId, response.data, response.headers)
    return response.data
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && status === 404) {
      logger.info(`ℹ️ Workflow run ${runId} not found for ${owner}/${repo} (likely expired or deleted upstream)`)
      return null
    }
    const stack = error instanceof Error ? error.stack : undefined
    logger.warn(`⚠️ Failed to get workflow run ${runId} for ${owner}/${repo}:`, { error: message, stack_trace: stack })
    return null
  }
}

export type WorkflowRunSnapshotFetchResult =
  | { status: 'not_applicable' | 'not_found' }
  | { status: 'already_present' | 'fetched'; workflowRunResolution: WorkflowRunResolution }
  | { status: 'rate_limited'; remaining: number }
  | { status: 'failed'; error: string }

export interface WorkflowRunResolution {
  workflowTriggerConfig: WorkflowTriggerConfig | null
  branchName: string | null
}

export interface ParsedWorkflowRunUrl {
  owner: string
  repo: string
  runId: number
}

export function parseWorkflowRunUrl(
  triggerUrl: string | null | undefined,
  expectedOwner: string,
  expectedRepo: string,
): ParsedWorkflowRunUrl | null {
  const match = triggerUrl?.match(
    /^https:\/\/github[.]com\/([^/?#]+)\/([^/?#]+)\/actions\/runs\/([0-9]+)(?:[/?#].*)?$/i,
  )
  if (
    !match ||
    match[1].toLowerCase() !== expectedOwner.toLowerCase() ||
    match[2].toLowerCase() !== expectedRepo.toLowerCase()
  ) {
    return null
  }

  const runId = Number(match[3])
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return null
  }

  return { owner: match[1], repo: match[2], runId }
}

export async function fetchWorkflowRunSnapshotIfMissing(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
  githubRepoId: number | string,
): Promise<WorkflowRunSnapshotFetchResult> {
  const workflowRun = parseWorkflowRunUrl(triggerUrl, owner, repo)
  if (!workflowRun) {
    return { status: 'not_applicable' }
  }

  const runId = workflowRun.runId
  let existingSnapshot: unknown | null
  try {
    existingSnapshot = await getWorkflowRunRawSnapshotData(githubRepoId, runId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(
      `Failed to check workflow-run snapshot ${runId} for ${owner}/${repo}`,
      error instanceof Error ? error : new Error(message),
    )
    return { status: 'failed', error: message }
  }
  if (existingSnapshot !== null) {
    return {
      status: 'already_present',
      workflowRunResolution: workflowRunResolutionFromRawData(existingSnapshot),
    }
  }

  const rateLimitRemaining = getGitHubRateLimitRemaining()
  if (rateLimitRemaining !== null && rateLimitRemaining < GITHUB_RATE_LIMIT_SAFETY_BUFFER) {
    return { status: 'rate_limited', remaining: rateLimitRemaining }
  }

  let response: Awaited<ReturnType<ReturnType<typeof getGitHubClient>['actions']['getWorkflowRun']>>
  try {
    response = await getGitHubClient().actions.getWorkflowRun({ owner, repo, run_id: runId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = (error as { status?: unknown }).status
    const rateLimitError = getGitHubRateLimitError(error)
    if (rateLimitError) {
      logger.warn(`⚠️ GitHub rate limit reached while fetching workflow run ${runId} for ${owner}/${repo}`, {
        remaining: rateLimitError.remaining,
      })
      return { status: 'rate_limited', remaining: rateLimitError.remaining }
    }
    if (status === 404) {
      logger.info(`ℹ️ Workflow run ${runId} not found for ${owner}/${repo} (likely expired or deleted upstream)`)
      return { status: 'not_found' }
    }
    logger.warn(`⚠️ Failed to fetch workflow run ${runId} for ${owner}/${repo}:`, { error: message })
    return { status: 'failed', error: message }
  }

  try {
    if (String(response.data.repository?.id) !== String(githubRepoId)) {
      const error = `Workflow run ${runId} belongs to GitHub repository ${response.data.repository?.id ?? 'unknown'}, not ${githubRepoId}`
      logger.warn(`⚠️ Refusing to archive workflow run ${runId} for ${owner}/${repo}:`, { error })
      return { status: 'failed', error }
    }

    const apiVersion = captureApiVersionMetadata(response.headers, null)
    await saveWorkflowRunRawSnapshot(owner, repo, githubRepoId, runId, response.data, apiVersion)
    return {
      status: 'fetched',
      workflowRunResolution: workflowRunResolutionFromRawData(response.data),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(
      `Failed to archive workflow run ${runId} for ${owner}/${repo}`,
      error instanceof Error ? error : new Error(message),
    )
    return { status: 'failed', error: message }
  }
}

export async function fetchWorkflowRunHeadSha(
  owner: string,
  repo: string,
  runId: number,
  runAttempt: number,
  expectedRepositoryId: string,
): Promise<string | null> {
  const snapshot = await getWorkflowRunRawSnapshotData(expectedRepositoryId, runId, runAttempt)
  if (isMatchingWorkflowRunHeadSha(snapshot, expectedRepositoryId, runAttempt)) {
    return snapshot.head_sha.toLowerCase()
  }

  if (await hasRecentWorkflowRunAttemptShaFailure(expectedRepositoryId, runId, runAttempt)) {
    return null
  }

  const rateLimitRemaining = getGitHubRateLimitRemaining()
  if (rateLimitRemaining !== null && rateLimitRemaining < GITHUB_RATE_LIMIT_SAFETY_BUFFER) {
    logger.warn(`⚠️ GitHub rate limit near exhaustion; skipping SHA lookup for workflow run ${runId}`, {
      remaining: rateLimitRemaining,
    })
    return null
  }

  let response: Awaited<ReturnType<ReturnType<typeof getGitHubClient>['actions']['getWorkflowRunAttempt']>>
  try {
    response = await getGitHubClient().actions.getWorkflowRunAttempt({
      owner,
      repo,
      run_id: runId,
      attempt_number: runAttempt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = (error as { status?: unknown }).status
    const rateLimitError = getGitHubRateLimitError(error)
    if (rateLimitError) {
      logger.warn(`⚠️ GitHub rate limit reached while fetching workflow run ${runId} for ${owner}/${repo}`, {
        remaining: rateLimitError.remaining,
      })
      return null
    }
    if (status === 404) {
      await recordWorkflowRunAttemptShaFailure(expectedRepositoryId, runId, runAttempt)
    }
    logger.warn(`⚠️ Could not resolve deployed commit from workflow run ${runId} for ${owner}/${repo}`, {
      error: message,
    })
    return null
  }

  if (String(response.data.repository?.id) !== expectedRepositoryId) {
    await recordWorkflowRunAttemptShaFailure(expectedRepositoryId, runId, runAttempt)
    logger.warn(`⚠️ Workflow run ${runId} belongs to a different GitHub repository than Nais claims`)
    return null
  }
  if (!isMatchingWorkflowRunHeadSha(response.data, expectedRepositoryId, runAttempt)) {
    await recordWorkflowRunAttemptShaFailure(expectedRepositoryId, runId, runAttempt)
    logger.warn(`⚠️ Workflow run ${runId} has an invalid head SHA`)
    return null
  }

  await saveWorkflowRunRawSnapshot(
    owner,
    repo,
    expectedRepositoryId,
    runId,
    response.data,
    captureApiVersionMetadata(response.headers, null),
  )
  return response.data.head_sha.toLowerCase()
}

function isMatchingWorkflowRunHeadSha(
  data: unknown,
  expectedRepositoryId: string,
  expectedRunAttempt: number,
): data is { head_sha: string; run_attempt: number } {
  if (!data || typeof data !== 'object') return false
  const run = data as Record<string, unknown>
  const repository = run.repository
  if (!repository || typeof repository !== 'object') return false
  const repositoryData = repository as Record<string, unknown>
  return (
    String(repositoryData.id) === expectedRepositoryId &&
    run.run_attempt === expectedRunAttempt &&
    typeof run.head_sha === 'string' &&
    /^[a-f0-9]{40}$/i.test(run.head_sha)
  )
}

async function archiveWorkflowRunRawSnapshot(
  owner: string,
  repo: string,
  runId: number,
  data: WorkflowRunData,
  headers: Record<string, unknown>,
): Promise<void> {
  try {
    const githubRepoId = await getRepositoryId(owner, repo)
    if (githubRepoId === null) return
    const apiVersion = captureApiVersionMetadata(headers, null)
    await saveWorkflowRunRawSnapshot(owner, repo, githubRepoId, runId, data, apiVersion)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`⚠️ Failed to archive workflow run ${runId} for ${owner}/${repo}:`, { error: message })
  }
}

export async function getBranchFromWorkflowRun(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
): Promise<string | null> {
  const run = await resolveWorkflowRun(owner, repo, triggerUrl)
  return run?.head_branch || null
}

export const WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION = 3

export type WorkflowTriggerConfig = {
  workflowPath: string
  triggerEvent: string
  checkSuiteId: number | null
  schemaVersion: number
}

function workflowRunResolutionFromRawData(data: unknown): WorkflowRunResolution {
  if (!data || typeof data !== 'object') return { workflowTriggerConfig: null, branchName: null }
  const run = data as Record<string, unknown>
  const workflowTriggerConfig =
    typeof run.path === 'string' &&
    typeof run.event === 'string' &&
    (run.check_suite_id === undefined || run.check_suite_id === null || typeof run.check_suite_id === 'number')
      ? {
          workflowPath: run.path,
          triggerEvent: run.event,
          checkSuiteId: typeof run.check_suite_id === 'number' ? run.check_suite_id : null,
          schemaVersion: WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION,
        }
      : null
  return {
    workflowTriggerConfig,
    branchName: typeof run.head_branch === 'string' ? run.head_branch : null,
  }
}

export async function getWorkflowTriggerConfig(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
): Promise<WorkflowTriggerConfig | null> {
  const run = await resolveWorkflowRun(owner, repo, triggerUrl)
  if (!run?.path) return null

  return {
    workflowPath: run.path,
    triggerEvent: run.event,
    checkSuiteId: run.check_suite_id ?? null,
    schemaVersion: WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION,
  }
}

export async function getRepositoryDefaultBranch(owner: string, repo: string): Promise<string | null> {
  try {
    const client = getGitHubClient()
    const response = await client.repos.get({ owner, repo })
    return response.data.default_branch || null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    logger.warn(`⚠️ Failed to fetch default_branch for ${owner}/${repo}:`, { error: message, stack_trace: stack })
    return null
  }
}

const REPOSITORY_ID_CACHE_TTL_MS = 5 * 60 * 1000

const repositoryIdCache = new Map<string, { promise: Promise<number | null>; expiresAt: number }>()

export async function getRepositoryId(owner: string, repo: string): Promise<number | null> {
  const cacheKey = `${owner}/${repo}`
  const cached = repositoryIdCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = (async () => {
    try {
      const client = getGitHubClient()
      const response = await client.repos.get({ owner, repo })
      return response.data.id
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      logger.warn(`⚠️ Failed to fetch repository id for ${owner}/${repo}:`, { error: message, stack_trace: stack })
      repositoryIdCache.delete(cacheKey)
      return null
    }
  })()

  repositoryIdCache.set(cacheKey, { promise, expiresAt: Date.now() + REPOSITORY_ID_CACHE_TTL_MS })
  return promise
}
