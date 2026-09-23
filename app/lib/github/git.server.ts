import {
  getLatestWorkflowRunRawSnapshot,
  saveCommitRawSnapshot,
  saveCompareRawSnapshot,
  saveWorkflowRunRawSnapshot,
} from '~/db/github-data.server'
import { logger } from '~/lib/logger.server'
import type { CompareData } from '~/lib/verification/types'
import { getGitHubClient } from './client.server'
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

export type CommitAncestryStatus = 'identical' | 'ahead' | 'behind' | 'diverged'

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

function extractRepositoryIdFromWorkflowRunData(data: unknown): number | null {
  if (data && typeof data === 'object' && 'repository' in data) {
    const repositoryId = (data as { repository?: { id?: unknown } }).repository?.id
    if (typeof repositoryId === 'number') return repositoryId
  }
  return null
}

/**
 * Whether triggerUrl contains a GitHub Actions workflow run id, i.e. whether
 * resolveGithubRepoIdFromWorkflowRun below can even attempt a lookup. Callers should use
 * this to decide whether a null result means "no workflow run to check" (safe to fall back
 * to owner/name matching) versus "a workflow run exists but couldn't be resolved" (NOT safe
 * to fall back, since the old repository's name may since have been reused by another repo).
 */
export function hasResolvableWorkflowRunId(triggerUrl: string | null | undefined): boolean {
  return /\/actions\/runs\/(\d+)/.test(triggerUrl ?? '')
}

/**
 * Resolves the immutable GitHub repository id for a deployment via its workflow run,
 * rather than owner/repo name matching. A workflow run id is globally unique and
 * permanently tied to the repository it was created in, so this is safe even when a
 * repository has since been renamed (the API redirects) or its old name reused by an
 * unrelated repository (the run id lookup then 404s instead of resolving to the wrong repo).
 */
export async function resolveGithubRepoIdFromWorkflowRun(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
): Promise<number | null> {
  const match = triggerUrl?.match(/\/actions\/runs\/(\d+)/)
  if (!match) return null
  const runId = parseInt(match[1], 10)

  const cached = await getLatestWorkflowRunRawSnapshot(owner, repo, runId)
  if (cached) {
    const cachedRepositoryId = extractRepositoryIdFromWorkflowRunData(cached.data)
    if (cachedRepositoryId !== null) return cachedRepositoryId
  }

  try {
    const client = getGitHubClient()
    const response = await client.actions.getWorkflowRun({ owner, repo, run_id: runId })
    const repositoryId = extractRepositoryIdFromWorkflowRunData(response.data)
    if (repositoryId !== null) {
      const apiVersion = captureApiVersionMetadata(response.headers, null)
      await saveWorkflowRunRawSnapshot(owner, repo, repositoryId, runId, response.data, apiVersion)
    }
    return repositoryId
  } catch (error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && status === 404) {
      logger.info(`ℹ️ Workflow run ${runId} not found for ${owner}/${repo} (cannot resolve repository id)`)
      return null
    }
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    logger.warn(`⚠️ Failed to resolve repository id from workflow run ${runId} for ${owner}/${repo}:`, {
      error: message,
      stack_trace: stack,
    })
    return null
  }
}

export const WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION = 3

export type WorkflowTriggerConfig = {
  workflowPath: string
  triggerEvent: string
  checkSuiteId: number | null
  schemaVersion: number
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

export async function getRepositoryId(
  owner: string,
  repo: string,
  options?: { bypassCache?: boolean },
): Promise<number | null> {
  const cacheKey = `${owner}/${repo}`
  if (!options?.bypassCache) {
    const cached = repositoryIdCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.promise
  }

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
