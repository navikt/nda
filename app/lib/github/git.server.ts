import { logger } from '~/lib/logger.server'
import type { CompareData } from '~/lib/verification/types'
import { getGitHubClient } from './client.server'

/**
 * Compare two commits and get the commits between them
 * Returns commits that are in 'head' but not in 'base'
 */
export async function getCommitsBetween(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<CompareData | null> {
  try {
    const client = getGitHubClient()

    logger.info(`🔍 Comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)} in ${owner}/${repo}`)

    const response = await client.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    })

    logger.info(`   📊 GitHub API response:`)
    logger.info(`      - Status: ${response.data.status}`)
    logger.info(`      - Ahead by: ${response.data.ahead_by} commits`)
    logger.info(`      - Behind by: ${response.data.behind_by} commits`)
    logger.info(`      - Total commits: ${response.data.total_commits}`)

    // Handle case where commits array might be undefined or empty
    const rawCommits = response.data.commits || []
    const rawFiles = response.data.files || []
    logger.info(`      - Commits array length: ${rawCommits.length}`)
    logger.info(`      - Files array length: ${rawFiles.length}`)

    const commits = rawCommits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      authorUsername: commit.author?.login || commit.commit.author?.name || 'unknown',
      authorDate: commit.commit.author?.date || '',
      committerDate: commit.commit.committer?.date || commit.commit.author?.date || '',
      htmlUrl: commit.html_url,
      isMergeCommit: (commit.parents?.length || 0) > 1,
      parentShas: commit.parents?.map((p) => p.sha) || [],
    }))

    logger.info(`✅ Found ${commits.length} commit(s) between ${base.substring(0, 7)} and ${head.substring(0, 7)}`)

    if (commits.length > 0 && commits.length <= 10) {
      logger.info(`   📝 Commits:`)
      commits.forEach((c, idx) => {
        logger.info(
          `      ${idx + 1}. ${c.sha.substring(0, 7)} by ${c.authorUsername}: ${c.message.split('\n')[0].substring(0, 50)}`,
        )
      })
    }

    return {
      compare: {
        status: response.data.status,
        aheadBy: response.data.ahead_by,
        behindBy: response.data.behind_by,
        totalCommits: response.data.total_commits,
        changedFiles: rawFiles.length,
        noDiffDetected: false,
      },
      commits,
    }
  } catch (error) {
    logger.error(`❌ Error comparing commits ${base.substring(0, 7)}...${head.substring(0, 7)}:`, error)
    return null
  }
}

/**
 * Check whether two commits have the same tree (no content changes).
 * Returns null when GitHub cannot be queried.
 */
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

    return baseCommit.data.commit.tree?.sha === headCommit.data.commit.tree?.sha
  } catch (error) {
    logger.warn(
      `⚠️ Failed to compare commit trees for ${baseSha.substring(0, 7)}...${headSha.substring(0, 7)} in ${owner}/${repo}:`,
      error as Record<string, unknown>,
    )
    return null
  }
}

/**
 * Check if a commit SHA exists on a given branch.
 * Uses the compare API: if the branch is identical to or ahead of the commit,
 * the commit is reachable from the branch.
 *
 * Returns null on API error (fail-open: caller should treat as unknown).
 */
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

    // If branch is identical or ahead of commit, the commit is on the branch
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

/**
 * Fetch the GitHub repository's default branch (e.g., "main" or "master").
 * Returns null on API error (e.g., repo gone, permissions, rate limit).
 *
 * Used by sync to keep `monitored_applications.default_branch` in sync with
 * the actual GitHub state, so PR base-branch filtering during verification
 * uses the correct value.
 */
/**
 * Get the branch name from a GitHub Actions workflow run URL.
 * Used to detect which branch a deployment was made from when it's not on the default branch.
 */
export async function getBranchFromWorkflowRun(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
): Promise<string | null> {
  if (!triggerUrl) return null
  const match = triggerUrl.match(/\/actions\/runs\/(\d+)/)
  if (!match) return null
  const runId = parseInt(match[1], 10)
  try {
    const client = getGitHubClient()
    const response = await client.actions.getWorkflowRun({ owner, repo, run_id: runId })
    return response.data.head_branch || null
  } catch (error) {
    logger.warn(`⚠️ Failed to get workflow run ${runId} for ${owner}/${repo}:`, error as Record<string, unknown>)
    return null
  }
}

export async function getRepositoryDefaultBranch(owner: string, repo: string): Promise<string | null> {
  try {
    const client = getGitHubClient()
    const response = await client.repos.get({ owner, repo })
    return response.data.default_branch || null
  } catch (error) {
    logger.warn(`⚠️ Failed to fetch default_branch for ${owner}/${repo}:`, error as Record<string, unknown>)
    return null
  }
}
