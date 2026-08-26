import { savePrWindowRawSnapshot } from '~/db/github-data.server'
import { logger } from '~/lib/logger.server'
import { getGitHubClient } from '../client.server'
import { getRepositoryId } from '../git.server'
import { captureApiVersionMetadata } from '../pr-snapshot'

interface MergedPullRequestInWindow {
  number: number
  title: string
  htmlUrl: string
  mergedAt: string
  baseBranch: string
  headSha: string
  mergeCommitSha: string | null
  authorUsername: string | null
  mergedByUsername: string | null
}

export async function getMergedPullRequestsInWindow(
  owner: string,
  repo: string,
  baseBranch: string,
  windowStart: string,
  windowEnd: string,
): Promise<MergedPullRequestInWindow[]> {
  const client = getGitHubClient()
  const startMs = new Date(windowStart).getTime()
  const endMs = new Date(windowEnd).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error(`Invalid merged PR window: start=${windowStart}, end=${windowEnd}`)
  }

  const searchStartDate = new Date(startMs).toISOString().slice(0, 10)
  const searchEndDate = new Date(endMs).toISOString().slice(0, 10)
  const query = `repo:${owner}/${repo} is:pr is:merged base:${baseBranch} merged:${searchStartDate}..${searchEndDate}`
  const prNumbers = new Set<number>()
  const perPage = 100
  const maxPages = 10

  for (let page = 1; page <= maxPages; page++) {
    const response = await client.search.issuesAndPullRequests({
      q: query,
      sort: 'updated',
      order: 'desc',
      per_page: perPage,
      page,
    })

    const { items } = response.data
    if (items.length === 0) break

    for (const item of items) {
      if (item.pull_request && typeof item.number === 'number') {
        prNumbers.add(item.number)
      }
    }

    if (items.length < perPage) break
  }

  const mergedPrResults = await Promise.allSettled(
    [...prNumbers].map(async (pullNumber): Promise<MergedPullRequestInWindow | null> => {
      try {
        const prResponse = await client.pulls.get({
          owner,
          repo,
          pull_number: pullNumber,
        })
        await archivePrWindowRawSnapshot(owner, repo, pullNumber, prResponse.data, prResponse.headers)
        const pr = prResponse.data
        if (!pr.merged_at) return null
        if (pr.base.ref !== baseBranch) return null

        const mergedAtMs = new Date(pr.merged_at).getTime()
        if (Number.isNaN(mergedAtMs)) return null
        if (mergedAtMs < startMs || mergedAtMs > endMs) return null

        return {
          number: pr.number,
          title: pr.title,
          htmlUrl: pr.html_url,
          mergedAt: pr.merged_at,
          baseBranch: pr.base.ref,
          headSha: pr.head.sha,
          mergeCommitSha: pr.merge_commit_sha,
          authorUsername: pr.user?.login ?? null,
          mergedByUsername: pr.merged_by?.login ?? null,
        }
      } catch (error) {
        logger.warn(`Could not fetch PR #${pullNumber} for merged PR window: ${error}`)
        return null
      }
    }),
  )

  const mergedPrs: MergedPullRequestInWindow[] = mergedPrResults
    .filter(
      (result): result is PromiseFulfilledResult<MergedPullRequestInWindow | null> => result.status === 'fulfilled',
    )
    .map((result) => result.value)
    .filter((pr): pr is MergedPullRequestInWindow => pr !== null)

  return mergedPrs.sort((a, b) => new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime())
}

export async function archivePrWindowRawSnapshot(
  owner: string,
  repo: string,
  prNumber: number,
  data: unknown,
  headers: Record<string, unknown>,
): Promise<void> {
  try {
    const githubRepoId = await getRepositoryId(owner, repo)
    if (githubRepoId === null) return
    const apiVersion = captureApiVersionMetadata(headers, null)
    await savePrWindowRawSnapshot(owner, repo, githubRepoId, prNumber, data, apiVersion)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`⚠️ Failed to archive PR #${prNumber} for ${owner}/${repo}:`, { error: message })
  }
}
