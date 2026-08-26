import type { GitHubPRData } from '~/db/deployments.server'
import { saveCommitAssociatedPrsRawSnapshot } from '~/db/github-data.server'
import { logger } from '~/lib/logger.server'
import { getGitHubClient } from './client.server'
import { getRepositoryId } from './git.server'
import {
  type ApiVersionMetadata,
  captureApiVersionMetadata,
  derivePrDataFromRaw,
  type RawPrSnapshotData,
} from './pr-snapshot'

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

export { getMergedPullRequestsInWindow } from './pr/merged-window.server'

interface PullRequestLookupResult {
  pr: PullRequest | null
  allAssociatedPrs: Array<{ number: number; baseBranch: string }>
}

async function archiveCommitAssociatedPrsRawSnapshot(
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
    await saveCommitAssociatedPrsRawSnapshot(owner, repo, githubRepoId, sha, data, apiVersion)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`⚠️ Failed to archive commit-associated PRs for ${sha.substring(0, 7)} in ${owner}/${repo}:`, {
      error: message,
    })
  }
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

    await archiveCommitAssociatedPrsRawSnapshot(owner, repo, sha, response.data, response.headers)

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

export { getPullRequestReviews } from './pr/four-eyes-legacy.server'

export async function getDetailedPullRequestInfo(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<{
  prData: GitHubPRData
  raw: RawPrSnapshotData
  githubRepoId: number
  apiVersion: ApiVersionMetadata
} | null> {
  const client = getGitHubClient()

  try {
    let apiVersion: ApiVersionMetadata | null = null
    const captureHeaders = (headers: Record<string, unknown>): void => {
      apiVersion = captureApiVersionMetadata(headers, apiVersion)
    }

    const [prResponse, allReviews, allCommitsData, allIssueComments, allReviewComments] = await Promise.all([
      client.pulls.get({ owner, repo, pull_number }),
      client.paginate(client.pulls.listReviews, { owner, repo, pull_number, per_page: 100 }, (response) => {
        captureHeaders(response.headers)
        return response.data
      }),
      client.paginate(client.pulls.listCommits, { owner, repo, pull_number, per_page: 100 }, (response) => {
        captureHeaders(response.headers)
        return response.data
      }),
      client.paginate(
        client.issues.listComments,
        { owner, repo, issue_number: pull_number, per_page: 100 },
        (response) => {
          captureHeaders(response.headers)
          return response.data
        },
      ),
      client.paginate(client.pulls.listReviewComments, { owner, repo, pull_number, per_page: 100 }, (response) => {
        captureHeaders(response.headers)
        return response.data
      }),
    ])

    captureHeaders(prResponse.headers)

    const pr = prResponse.data
    const raw: RawPrSnapshotData = {
      pr,
      reviews: allReviews,
      commits: allCommitsData,
      issueComments: allIssueComments,
      reviewComments: allReviewComments,
    }

    return {
      prData: derivePrDataFromRaw(raw),
      raw,
      githubRepoId: pr.base.repo.id,
      apiVersion: apiVersion ?? { apiVersion: 'unknown', apiDeprecatedAt: null, apiSunsetAt: null },
    }
  } catch (error) {
    logger.error('Error fetching detailed PR info:', error)
    return null
  }
}

export async function getMutablePrDataFromGitHub(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<{
  githubRepoId: number
  reviews: RawPrSnapshotData['reviews']
  issueComments: RawPrSnapshotData['issueComments']
  reviewComments: RawPrSnapshotData['reviewComments']
  apiVersion: ApiVersionMetadata
} | null> {
  const client = getGitHubClient()

  try {
    let apiVersion: ApiVersionMetadata | null = null
    const captureHeaders = (headers: Record<string, unknown>): void => {
      apiVersion = captureApiVersionMetadata(headers, apiVersion)
    }

    const [repoResponse, allReviews, allIssueComments, allReviewComments] = await Promise.all([
      client.repos.get({ owner, repo }),
      client.paginate(client.pulls.listReviews, { owner, repo, pull_number, per_page: 100 }, (response) => {
        captureHeaders(response.headers)
        return response.data
      }),
      client.paginate(
        client.issues.listComments,
        { owner, repo, issue_number: pull_number, per_page: 100 },
        (response) => {
          captureHeaders(response.headers)
          return response.data
        },
      ),
      client.paginate(client.pulls.listReviewComments, { owner, repo, pull_number, per_page: 100 }, (response) => {
        captureHeaders(response.headers)
        return response.data
      }),
    ])

    return {
      githubRepoId: repoResponse.data.id,
      reviews: allReviews,
      issueComments: allIssueComments,
      reviewComments: allReviewComments,
      apiVersion: apiVersion ?? { apiVersion: 'unknown', apiDeprecatedAt: null, apiSunsetAt: null },
    }
  } catch (error) {
    logger.error('Error fetching mutable PR data:', error)
    return null
  }
}

export async function getDisplayDataFromGitHub(
  owner: string,
  repo: string,
  pull_number: number,
): Promise<{
  githubRepoId: number
  pr: RawPrSnapshotData['pr']
  issueComments: RawPrSnapshotData['issueComments']
  apiVersion: ApiVersionMetadata
} | null> {
  const client = getGitHubClient()

  try {
    let apiVersion: ApiVersionMetadata | null = null
    const captureHeaders = (headers: Record<string, unknown>): void => {
      apiVersion = captureApiVersionMetadata(headers, apiVersion)
    }

    const [prResponse, allIssueComments] = await Promise.all([
      client.pulls.get({ owner, repo, pull_number }),
      client.paginate(
        client.issues.listComments,
        { owner, repo, issue_number: pull_number, per_page: 100 },
        (response) => {
          captureHeaders(response.headers)
          return response.data
        },
      ),
    ])

    captureHeaders(prResponse.headers)

    return {
      githubRepoId: prResponse.data.base.repo.id,
      pr: prResponse.data,
      issueComments: allIssueComments,
      apiVersion: apiVersion ?? { apiVersion: 'unknown', apiDeprecatedAt: null, apiSunsetAt: null },
    }
  } catch (error) {
    logger.error('Error fetching PR display data:', error)
    return null
  }
}
