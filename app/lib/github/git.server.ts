import { logger } from '~/lib/logger.server'
import type { CompareData } from '~/lib/verification/types'
import { getGitHubClient } from './client.server'

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
    return response.data.commit.message || null
  } catch (error) {
    logger.warn(
      `⚠️ Failed to fetch commit message for ${commitSha.substring(0, 7)} in ${owner}/${repo}:`,
      error as Record<string, unknown>,
    )
    return null
  }
}

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
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    logger.warn(`⚠️ Failed to get workflow run ${runId} for ${owner}/${repo}:`, { error: message, stack_trace: stack })
    return null
  }
}

export type WorkflowTriggerConfig = {
  workflowPath: string
  triggerEvent: string
  triggerYaml: string
}

function extractTriggerBlock(workflowContent: string): string | null {
  const lines = workflowContent.split('\n')
  const startIndex = lines.findIndex((line) => /^on:/.test(line) || /^["']?on["']?:/.test(line))
  if (startIndex === -1) return null

  const triggerLines = [lines[startIndex]]
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    const isTopLevelKey = /^\S/.test(line)
    if (isTopLevelKey) break
    triggerLines.push(line)
  }

  while (triggerLines.length > 1 && triggerLines[triggerLines.length - 1].trim() === '') {
    triggerLines.pop()
  }

  return triggerLines.join('\n')
}

export async function getWorkflowTriggerConfig(
  owner: string,
  repo: string,
  triggerUrl: string | null | undefined,
): Promise<WorkflowTriggerConfig | null> {
  const match = triggerUrl?.match(/\/actions\/runs\/(\d+)/)
  if (!match) return null
  const runId = parseInt(match[1], 10)

  try {
    const client = getGitHubClient()
    const run = await client.actions.getWorkflowRun({ owner, repo, run_id: runId })
    const workflowPath = run.data.path
    const triggerEvent = run.data.event
    const ref = run.data.head_sha
    if (!workflowPath) return null

    const contentResponse = await client.repos.getContent({ owner, repo, path: workflowPath, ref })
    const fileData = contentResponse.data
    if (Array.isArray(fileData) || fileData.type !== 'file' || !fileData.content) return null

    const workflowContent = Buffer.from(fileData.content, 'base64').toString('utf-8')
    const triggerYaml = extractTriggerBlock(workflowContent)
    if (!triggerYaml) return null

    return { workflowPath, triggerEvent, triggerYaml }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    logger.warn(`⚠️ Failed to get workflow trigger config for run ${runId} in ${owner}/${repo}:`, {
      error: message,
      stack_trace: stack,
    })
    return null
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
