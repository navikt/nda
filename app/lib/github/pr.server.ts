import type { GitHubPRData } from '~/db/deployments.server'
import { isDependabotUser } from '~/lib/dependabot'
import { logger } from '~/lib/logger.server'
import { getGitHubClient } from './client.server'

const prCommitsCache = new Map<string, string[]>()

function _clearPrCommitsCache(): void {
  prCommitsCache.clear()
}

interface PullRequest {
  number: number
  title: string
  html_url: string
  merged_at: string | null
  state: string
}

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

interface PullRequestLookupResult {
  pr: PullRequest | null
  allAssociatedPrs: Array<{ number: number; baseBranch: string }>
}

export async function getPullRequestForCommit(
  owner: string,
  repo: string,
  sha: string,
  verifyCommitIsInPR: boolean = false,
  baseBranch?: string,
): Promise<PullRequestLookupResult> {
  const client = getGitHubClient()

  try {
    logger.info(
      `🔎 Searching for PRs associated with commit ${sha} in ${owner}/${repo}${baseBranch ? ` (base: ${baseBranch})` : ''}`,
    )

    const response = await client.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: sha,
    })

    logger.info(`📊 Found ${response.data.length} PR(s) associated with commit ${sha}`)

    const allAssociatedPrs = response.data.map((pr) => ({ number: pr.number, baseBranch: pr.base.ref }))

    if (response.data.length === 0) {
      logger.info(`❌ No PRs found for commit ${sha}`)
      return { pr: null, allAssociatedPrs }
    }

    const filteredPRs = baseBranch ? response.data.filter((pr) => pr.base.ref === baseBranch) : response.data

    if (baseBranch && filteredPRs.length !== response.data.length) {
      logger.info(`   🔍 Filtered to ${filteredPRs.length} PR(s) targeting ${baseBranch}`)
    }

    filteredPRs.forEach((pr, index) => {
      logger.info(
        `   PR ${index + 1}: #${pr.number} - ${pr.title} (${pr.state}, merged: ${pr.merged_at ? 'yes' : 'no'}, base: ${pr.base.ref})`,
      )
    })

    if (filteredPRs.length === 0) {
      logger.info(`❌ No PRs found for commit ${sha} targeting ${baseBranch}`)
      return { pr: null, allAssociatedPrs }
    }

    if (verifyCommitIsInPR) {
      for (const pr of filteredPRs) {
        if (!pr.merged_at) continue

        if (pr.merge_commit_sha === sha) {
          logger.info(`✅ Commit ${sha.substring(0, 7)} is the merge/squash commit for PR #${pr.number}`)
          return {
            pr: {
              number: pr.number,
              title: pr.title,
              html_url: pr.html_url,
              merged_at: pr.merged_at,
              state: pr.state,
            },
            allAssociatedPrs,
          }
        }

        const cacheKey = `${owner}/${repo}#${pr.number}`
        let prCommitShas = prCommitsCache.get(cacheKey)

        const metadataCacheKey = `${owner}/${repo}#${pr.number}-metadata`
        let prCommitsMetadata = prCommitsMetadataCache.get(metadataCacheKey)

        if (!prCommitShas || !prCommitsMetadata) {
          try {
            let allPrCommits: Awaited<ReturnType<typeof client.pulls.listCommits>>['data'] = []
            let prCommitsPage = 1

            while (true) {
              const prCommitsResponse = await client.pulls.listCommits({
                owner,
                repo,
                pull_number: pr.number,
                per_page: 100,
                page: prCommitsPage,
              })

              allPrCommits = allPrCommits.concat(prCommitsResponse.data)

              if (prCommitsResponse.data.length < 100) {
                break
              }
              prCommitsPage++
            }

            prCommitShas = allPrCommits.map((c) => c.sha)
            prCommitsCache.set(cacheKey, prCommitShas)

            prCommitsMetadata = allPrCommits.map((c) => ({
              sha: c.sha,
              author: (c.commit.author?.name || c.author?.login || 'unknown').toLowerCase(),
              authorDate: c.commit.author?.date || '',
              messageFirstLine: c.commit.message.split('\n')[0].trim(),
            }))
            prCommitsMetadataCache.set(metadataCacheKey, prCommitsMetadata)
          } catch (err) {
            logger.warn(`Could not fetch commits for PR #${pr.number}: ${err}`)
            continue
          }
        } else {
          logger.info(`   📋 Using cached commits for PR #${pr.number} (${prCommitShas.length} commits)`)
        }

        const isInPR = prCommitShas.includes(sha)

        if (isInPR) {
          logger.info(`✅ Commit ${sha.substring(0, 7)} is an original commit in PR #${pr.number}`)
          return {
            pr: {
              number: pr.number,
              title: pr.title,
              html_url: pr.html_url,
              merged_at: pr.merged_at,
              state: pr.state,
            },
            allAssociatedPrs,
          }
        }

        if (prCommitsMetadata) {
          try {
            const commitResponse = await client.repos.getCommit({
              owner,
              repo,
              ref: sha,
            })
            const commitData = commitResponse.data

            const commitAuthor = (commitData.commit.author?.name || commitData.author?.login || 'unknown').toLowerCase()
            const commitAuthorDate = commitData.commit.author?.date || ''
            const commitMessageFirstLine = commitData.commit.message.split('\n')[0].trim()

            for (const prCommit of prCommitsMetadata) {
              const authorMatch = prCommit.author === commitAuthor

              let dateMatch = false
              if (prCommit.authorDate && commitAuthorDate) {
                const prDate = new Date(prCommit.authorDate)
                const mainDate = new Date(commitAuthorDate)
                const dateDiffMs = Math.abs(prDate.getTime() - mainDate.getTime())
                dateMatch = dateDiffMs < 1000
              }

              const messageMatch = prCommit.messageFirstLine === commitMessageFirstLine

              if (authorMatch && dateMatch && messageMatch) {
                logger.info(
                  `✅ Commit ${sha.substring(0, 7)} matches PR #${pr.number} via rebase (original: ${prCommit.sha.substring(0, 7)})`,
                )
                return {
                  pr: {
                    number: pr.number,
                    title: pr.title,
                    html_url: pr.html_url,
                    merged_at: pr.merged_at,
                    state: pr.state,
                    _rebase_matched: true,
                    _matched_original_sha: prCommit.sha,
                  } as PullRequestWithMatchInfo,
                  allAssociatedPrs,
                }
              }
            }
          } catch (err) {
            logger.warn(`Could not fetch commit ${sha} for rebase matching: ${err}`)
          }
        }

        logger.info(
          `⚠️  Commit ${sha.substring(0, 7)} is NOT in PR #${pr.number}'s original commits and no rebase match found`,
        )
      }

      logger.info(`❌ Commit ${sha.substring(0, 7)} was not an original commit in any associated PR`)
      return { pr: null, allAssociatedPrs }
    }

    const pr = filteredPRs[0]
    logger.info(`✅ Using PR #${pr.number} for verification`)

    return {
      pr: {
        number: pr.number,
        title: pr.title,
        html_url: pr.html_url,
        merged_at: pr.merged_at,
        state: pr.state,
      },
      allAssociatedPrs,
    }
  } catch (error) {
    logger.error(`❌ Error fetching PR for commit ${sha}:`, error)

    if (error instanceof Error && error.message.includes('rate limit')) {
      throw error
    }

    return { pr: null, allAssociatedPrs: [] }
  }
}

interface PullRequestWithMatchInfo extends PullRequest {
  _rebase_matched?: boolean
  _matched_original_sha?: string
}

interface PRCommitMetadata {
  sha: string
  author: string
  authorDate: string
  messageFirstLine: string
}
const prCommitsMetadataCache = new Map<string, PRCommitMetadata[]>()

async function _findPRForRebasedCommit(
  owner: string,
  repo: string,
  commitSha: string,
  commitAuthor: string,
  commitAuthorDate: string,
  commitMessage: string,
  sinceDate?: Date,
  baseBranch: string = 'main',
): Promise<PullRequestWithMatchInfo | null> {
  const client = getGitHubClient()

  const normalizedAuthor = commitAuthor.toLowerCase()
  const normalizedAuthorDate = new Date(commitAuthorDate).toISOString()
  const normalizedMessageFirstLine = commitMessage.split('\n')[0].trim()

  logger.info(
    `🔄 Attempting rebase match for commit ${commitSha.substring(0, 7)} (author: ${normalizedAuthor}, date: ${normalizedAuthorDate.substring(0, 19)}, base: ${baseBranch})`,
  )

  try {
    const mergedPRs = await client.pulls.list({
      owner,
      repo,
      state: 'closed',
      base: baseBranch,
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
    })

    const relevantPRs = mergedPRs.data.filter((pr) => {
      if (!pr.merged_at) return false
      if (sinceDate) {
        const mergedAt = new Date(pr.merged_at)
        return mergedAt >= sinceDate
      }
      return true
    })

    logger.info(`   📋 Checking ${relevantPRs.length} recently merged PRs for rebase match`)

    for (const pr of relevantPRs) {
      const cacheKey = `${owner}/${repo}#${pr.number}-metadata`
      let prCommits = prCommitsMetadataCache.get(cacheKey)

      if (!prCommits) {
        try {
          const allPrCommitsData: Array<{
            sha: string
            author: string
            authorDate: string
            messageFirstLine: string
          }> = []
          let prCommitsPage = 1

          while (true) {
            const prCommitsResponse = await client.pulls.listCommits({
              owner,
              repo,
              pull_number: pr.number,
              per_page: 100,
              page: prCommitsPage,
            })

            for (const c of prCommitsResponse.data) {
              allPrCommitsData.push({
                sha: c.sha,
                author: (c.commit.author?.name || c.author?.login || 'unknown').toLowerCase(),
                authorDate: c.commit.author?.date || '',
                messageFirstLine: c.commit.message.split('\n')[0].trim(),
              })
            }

            if (prCommitsResponse.data.length < 100) {
              break
            }
            prCommitsPage++
          }

          prCommits = allPrCommitsData
          prCommitsMetadataCache.set(cacheKey, prCommits)
        } catch (err) {
          logger.warn(`   Could not fetch commits for PR #${pr.number}:: ${err}`)
          continue
        }
      }

      for (const prCommit of prCommits) {
        const authorMatch = prCommit.author === normalizedAuthor
        const messageMatch = prCommit.messageFirstLine === normalizedMessageFirstLine

        let dateMatch = false
        if (prCommit.authorDate) {
          const prDate = new Date(prCommit.authorDate)
          const commitDate = new Date(normalizedAuthorDate)
          const dateDiffMs = Math.abs(prDate.getTime() - commitDate.getTime())
          dateMatch = dateDiffMs < 1000
        }

        if (authorMatch && dateMatch && messageMatch) {
          logger.info(
            `   ✅ Rebase match found! Commit ${commitSha.substring(0, 7)} matches PR #${pr.number} commit ${prCommit.sha.substring(0, 7)}`,
          )
          logger.info(`      Original: ${prCommit.sha.substring(0, 7)} → Rebased: ${commitSha.substring(0, 7)}`)

          return {
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            merged_at: pr.merged_at,
            state: pr.state,
            _rebase_matched: true,
            _matched_original_sha: prCommit.sha,
          }
        }
      }
    }

    logger.info(`   ❌ No rebase match found for commit ${commitSha.substring(0, 7)}`)
    return null
  } catch (error) {
    logger.error(`❌ Error finding PR for rebased commit ${commitSha}:`, error)

    if (error instanceof Error && error.message.includes('rate limit')) {
      throw error
    }

    return null
  }
}

function _clearPrCommitsMetadataCache(): void {
  prCommitsMetadataCache.clear()
}

interface PullRequestReview {
  id: number
  user: {
    login: string
  } | null
  state: string
  submitted_at: string | null
}

export async function getPullRequestReviews(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<PullRequestReview[]> {
  const client = getGitHubClient()

  const allReviews = await client.paginate(client.pulls.listReviews, {
    owner,
    repo,
    pull_number,
    per_page: 100,
  })

  return allReviews as PullRequestReview[]
}

interface PullRequestCommit {
  sha: string
  commit: {
    author: {
      date: string
      name?: string
    }
    message: string
  }
  author?: {
    login: string
  } | null
  parents: Array<{
    sha: string
  }>
}

async function getPullRequestCommits(owner: string, repo: string, pull_number: number): Promise<PullRequestCommit[]> {
  const client = getGitHubClient()

  logger.info(`   📄 Fetching commits for PR #${pull_number}...`)

  const allCommits = await client.paginate(client.pulls.listCommits, {
    owner,
    repo,
    pull_number,
    per_page: 100,
  })

  logger.info(`      Total: ${allCommits.length} commits`)

  return allCommits as PullRequestCommit[]
}

function isMergeFromMainBranch(commit: PullRequestCommit): boolean {
  if (commit.parents.length < 2) {
    return false
  }

  const message = commit.commit.message.toLowerCase()

  const mainBranchPatterns = [
    /merge\s+branch\s+['"]main['"]/i,
    /merge\s+branch\s+['"]master['"]/i,
    /merge\s+remote-tracking\s+branch\s+['"]origin\/main['"]/i,
    /merge\s+remote-tracking\s+branch\s+['"]origin\/master['"]/i,
    /merge\s+branch\s+['"]origin\/main['"]/i,
    /merge\s+branch\s+['"]origin\/master['"]/i,
  ]

  return mainBranchPatterns.some((pattern) => pattern.test(message))
}

async function _verifyPullRequestFourEyes(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<{ hasFourEyes: boolean; reason: string }> {
  try {
    logger.info(`🔍 Verifying four-eyes for PR #${pull_number} in ${owner}/${repo}`)

    const client = getGitHubClient()

    const prResponse = await client.pulls.get({
      owner,
      repo,
      pull_number,
    })

    const prCreator = prResponse.data.user?.login || ''
    const isDependabotPR = isDependabotUser(prCreator)

    logger.info(`   🤖 PR creator: ${prCreator} (Dependabot: ${isDependabotPR})`)

    const [reviews, commits] = await Promise.all([
      getPullRequestReviews(owner, repo, pull_number),
      getPullRequestCommits(owner, repo, pull_number),
    ])

    logger.info(`   📝 Found ${reviews.length} review(s) and ${commits.length} commit(s)`)

    if (commits.length === 0) {
      logger.info(`   ❌ No commits found in PR`)
      return { hasFourEyes: false, reason: 'No commits found in PR' }
    }

    const lastCommit = commits[commits.length - 1]
    const lastCommitDate = new Date(lastCommit.commit.author.date)
    logger.info(`   📅 Last commit: ${lastCommit.sha.substring(0, 7)} at ${lastCommitDate.toISOString()}`)
    logger.info(`   📝 Last commit message: ${lastCommit.commit.message.split('\n')[0].substring(0, 80)}`)

    const approvedReviewsAfterLastCommit = reviews.filter((review) => {
      if (review.state !== 'APPROVED' || !review.submitted_at) {
        return false
      }
      const reviewDate = new Date(review.submitted_at)
      return reviewDate > lastCommitDate
    })

    logger.info(`   ✅ ${approvedReviewsAfterLastCommit.length} approved review(s) after last commit`)

    if (approvedReviewsAfterLastCommit.length > 0) {
      const result = {
        hasFourEyes: true,
        reason: `Approved by ${approvedReviewsAfterLastCommit[0].user?.login || 'unknown'} after last commit`,
      }
      logger.info(`   ✅ Result: ${result.reason}`)
      return result
    }

    const approvedReviews = reviews.filter((r) => r.state === 'APPROVED')
    logger.info(`   ✅ ${approvedReviews.length} total approved review(s) found`)

    if (approvedReviews.length === 0) {
      logger.info(`   ❌ No approved reviews found`)
      return { hasFourEyes: false, reason: 'No approved reviews found' }
    }

    const mostRecentApproval = approvedReviews.reduce((latest, current) => {
      const currentDate = new Date(current.submitted_at || 0)
      const latestDate = new Date(latest.submitted_at || 0)
      return currentDate > latestDate ? current : latest
    })

    const approvalDate = new Date(mostRecentApproval.submitted_at || 0)
    logger.info(
      `   📅 Most recent approval: ${mostRecentApproval.user?.login || 'unknown'} at ${approvalDate.toISOString()}`,
    )

    const commitsAfterApproval = commits.filter((commit) => {
      const commitDate = new Date(commit.commit.author.date)
      return commitDate > approvalDate
    })

    logger.info(`   📊 ${commitsAfterApproval.length} commit(s) after most recent approval`)

    if (commitsAfterApproval.length === 0) {
      logger.info(`   ✅ Approval was after last commit`)
      return {
        hasFourEyes: true,
        reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'} after last commit`,
      }
    }

    commitsAfterApproval.forEach((commit, index) => {
      const isMainMerge = isMergeFromMainBranch(commit)
      const commitAuthor = commit.author?.login || commit.commit.author?.name || 'unknown'
      const message = commit.commit.message.split('\n')[0].substring(0, 80)
      logger.info(
        `   📝 Commit ${index + 1} after approval: ${commit.sha.substring(0, 7)} by ${commitAuthor} - ${message} (${commit.parents.length} parent(s), main merge: ${isMainMerge})`,
      )
    })

    if (isDependabotPR) {
      const allCommitsAreBotOrMainMerge = commitsAfterApproval.every((commit) => {
        const commitAuthor = commit.author?.login || commit.commit.author?.name || ''
        const isDependabotCommit = isDependabotUser(commitAuthor)
        const isMainMerge = isMergeFromMainBranch(commit)
        return isDependabotCommit || isMainMerge
      })

      logger.info(`   🤖 All commits after approval are by Dependabot or main merges: ${allCommitsAreBotOrMainMerge}`)

      if (allCommitsAreBotOrMainMerge) {
        const result = {
          hasFourEyes: true,
          reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'}, Dependabot PR with bot commits after approval`,
        }
        logger.info(`   ✅ Result: ${result.reason}`)
        return result
      }
    }

    const allCommitsAreMainMerges = commitsAfterApproval.every((commit) => isMergeFromMainBranch(commit))

    logger.info(`   🔀 All commits after approval are main/master merges: ${allCommitsAreMainMerges}`)

    if (allCommitsAreMainMerges) {
      const result = {
        hasFourEyes: true,
        reason: `Approved by ${mostRecentApproval.user?.login || 'unknown'}, only main/master merges after approval`,
      }
      logger.info(`   ✅ Result: ${result.reason}`)
      return result
    }

    const result = {
      hasFourEyes: false,
      reason: 'Approved review exists but came before the last commit (non-merge commits after approval)',
    }
    logger.info(`   ❌ Result: ${result.reason}`)
    return result
  } catch (error) {
    logger.error('Error verifying PR four eyes:', error)
    return { hasFourEyes: false, reason: 'Error checking reviews' }
  }
}

export async function getDetailedPullRequestInfo(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<GitHubPRData | null> {
  const client = getGitHubClient()

  try {
    const prResponse = await client.pulls.get({
      owner,
      repo,
      pull_number,
    })

    const pr = prResponse.data

    const allReviews = await client.paginate(client.pulls.listReviews, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    })

    const reviewsByUser = new Map<
      string,
      { username: string; avatar_url: string; state: string; submitted_at: string }
    >()

    const reviewBodyComments: Array<{
      id: number
      body: string
      user: { username: string; avatar_url: string }
      created_at: string
      html_url: string
    }> = []

    for (const review of allReviews) {
      if (review.user && review.submitted_at) {
        const existing = reviewsByUser.get(review.user.login)

        let shouldUpdate = false
        if (!existing) {
          shouldUpdate = true
        } else if (review.state === 'APPROVED' && existing.state !== 'APPROVED') {
          shouldUpdate = true
        } else if (review.state === 'APPROVED' && existing.state === 'APPROVED') {
          shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
        } else if (review.state !== 'APPROVED' && existing.state !== 'APPROVED') {
          shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
        }

        if (shouldUpdate) {
          reviewsByUser.set(review.user.login, {
            username: review.user.login,
            avatar_url: review.user.avatar_url,
            state: review.state,
            submitted_at: review.submitted_at,
          })
        }
        if (review.body?.trim()) {
          reviewBodyComments.push({
            id: review.id,
            body: review.body,
            user: {
              username: review.user.login,
              avatar_url: review.user.avatar_url,
            },
            created_at: review.submitted_at,
            html_url: review.html_url,
          })
        }
      }
    }

    let checks_passed: boolean | null = null
    const checks: Array<{
      id: number
      name: string
      status: string
      conclusion: string | null
      started_at: string | null
      completed_at: string | null
      html_url: string | null
      head_sha: string
      details_url: string | null
      external_id: string | null
      check_suite_id: number | null
      app: { name: string; slug: string | null } | null
      output: {
        title: string | null
        summary: string | null
        text: string | null
        annotations_count: number
      } | null
      annotations: Array<{
        path: string | null
        start_line: number
        end_line: number
        start_column: number | null
        end_column: number | null
        annotation_level: string
        message: string
        title: string | null
        raw_details: string | null
      }> | null
    }> = []

    try {
      const primaryRef = pr.merge_commit_sha ?? pr.head.sha
      let checksResponse = await client.checks.listForRef({ owner, repo, ref: primaryRef })

      if (checksResponse.data.total_count === 0 && pr.merge_commit_sha) {
        checksResponse = await client.checks.listForRef({ owner, repo, ref: pr.head.sha })
      }

      if (checksResponse.data.total_count > 0) {
        checks_passed = checksResponse.data.check_runs.every(
          (check) => check.conclusion === 'success' || check.conclusion === 'skipped',
        )

        for (const check of checksResponse.data.check_runs) {
          let annotations: (typeof checks)[number]['annotations'] = null
          if (check.output?.annotations_count && check.output.annotations_count > 0) {
            try {
              const annotationsResponse = await client.checks.listAnnotations({
                owner,
                repo,
                check_run_id: check.id,
              })
              annotations = annotationsResponse.data.map((a) => ({
                path: a.path ?? null,
                start_line: a.start_line,
                end_line: a.end_line,
                start_column: a.start_column ?? null,
                end_column: a.end_column ?? null,
                annotation_level: a.annotation_level ?? 'notice',
                message: a.message ?? '',
                title: a.title ?? null,
                raw_details: a.raw_details ?? null,
              }))
            } catch (error) {
              logger.warn(`Could not fetch annotations for check ${check.id}: ${error}`)
            }
          }

          checks.push({
            id: check.id,
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            started_at: check.started_at,
            completed_at: check.completed_at,
            html_url: check.html_url,
            head_sha: check.head_sha,
            details_url: check.details_url ?? null,
            external_id: check.external_id ?? null,
            check_suite_id: check.check_suite?.id ?? null,
            app: check.app ? { name: check.app.name, slug: check.app.slug ?? null } : null,
            output: check.output
              ? {
                  title: check.output.title,
                  summary: check.output.summary,
                  text: check.output.text,
                  annotations_count: check.output.annotations_count,
                }
              : null,
            annotations,
          })
        }
      }
    } catch (error) {
      logger.warn(`Could not fetch check runs: ${error}`)
    }

    let allCommitsData: Awaited<ReturnType<typeof client.pulls.listCommits>>['data'] = []
    let commitsPage = 1

    while (true) {
      const commitsResponse = await client.pulls.listCommits({
        owner,
        repo,
        pull_number,
        per_page: 100,
        page: commitsPage,
      })

      allCommitsData = allCommitsData.concat(commitsResponse.data)

      if (commitsResponse.data.length < 100) {
        break
      }
      commitsPage++
    }

    const commits = allCommitsData.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: {
        username: commit.author?.login || commit.commit.author?.name || 'unknown',
        avatar_url: commit.author?.avatar_url || '',
      },
      date: commit.commit.author?.date || '',
      html_url: commit.html_url,
    }))

    const allIssueComments = await client.paginate(client.issues.listComments, {
      owner,
      repo,
      issue_number: pull_number,
      per_page: 100,
    })

    const allReviewComments = await client.paginate(client.pulls.listReviewComments, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    })

    const issueComments = allIssueComments.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      user: {
        username: comment.user?.login || 'unknown',
        avatar_url: comment.user?.avatar_url || '',
      },
      created_at: comment.created_at,
      html_url: comment.html_url,
    }))

    const reviewComments = allReviewComments.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      user: {
        username: comment.user?.login || 'unknown',
        avatar_url: comment.user?.avatar_url || '',
      },
      created_at: comment.created_at,
      html_url: comment.html_url,
    }))

    const comments = [...issueComments, ...reviewComments, ...reviewBodyComments].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )

    return {
      title: pr.title,
      body: pr.body,
      labels: pr.labels.map((label) => (typeof label === 'string' ? label : label.name || '')),
      created_at: pr.created_at,
      merged_at: pr.merged_at,
      base_branch: pr.base.ref,
      base_sha: pr.base.sha,
      head_branch: pr.head.ref,
      head_sha: pr.head.sha,
      merge_commit_sha: pr.merge_commit_sha,
      commits_count: pr.commits,
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      comments_count: pr.comments,
      review_comments_count: pr.review_comments,
      draft: pr.draft || false,
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
      rebaseable: pr.rebaseable ?? null,
      locked: pr.locked,
      maintainer_can_modify: pr.maintainer_can_modify,
      auto_merge: pr.auto_merge
        ? {
            enabled_by: pr.auto_merge.enabled_by?.login || 'unknown',
            merge_method: pr.auto_merge.merge_method,
          }
        : null,
      creator: {
        username: pr.user?.login || 'unknown',
        avatar_url: pr.user?.avatar_url || '',
      },
      merged_by: pr.merged_by
        ? {
            username: pr.merged_by.login,
            avatar_url: pr.merged_by.avatar_url,
          }
        : null,
      merger: pr.merged_by
        ? {
            username: pr.merged_by.login,
            avatar_url: pr.merged_by.avatar_url,
          }
        : null,
      assignees: (pr.assignees || []).map((a) => ({
        username: a.login,
        avatar_url: a.avatar_url,
      })),
      requested_reviewers: (pr.requested_reviewers || []).map((r) => ({
        username: r.login,
        avatar_url: r.avatar_url,
      })),
      requested_teams: (pr.requested_teams || []).map((t) => ({
        name: t.name,
        slug: t.slug,
      })),
      milestone: pr.milestone
        ? {
            title: pr.milestone.title,
            number: pr.milestone.number,
            state: pr.milestone.state,
          }
        : null,
      reviewers: Array.from(reviewsByUser.values()),
      checks_passed,
      checks,
      commits,
      comments,
    }
  } catch (error) {
    logger.error('Error fetching detailed PR info:', error)
    return null
  }
}
