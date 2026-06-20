import { logger } from '~/lib/logger.server'
import { getGitHubClient } from './client.server'
import { getPullRequestForCommit, getPullRequestReviews } from './pr.server'

interface LegacyLookupResult {
  success: boolean
  error?: string
  data?: {
    commitSha: string
    commitMessage: string
    commitDate: Date
    commitAuthor: string
    prNumber?: number
    prTitle?: string
    prUrl?: string
    prMergedAt?: Date
    prAuthor?: string
    mergedBy?: string
    reviewers?: Array<{ username: string; state: string }>
    timeDifferenceMinutes: number
    isWithinThreshold: boolean
  }
}

export async function lookupLegacyByCommit(
  owner: string,
  repo: string,
  sha: string,
  deploymentTime: Date,
): Promise<LegacyLookupResult> {
  try {
    const client = getGitHubClient()

    logger.info(`🔍 Legacy lookup: Fetching commit ${sha} in ${owner}/${repo}`)

    const commitResponse = await client.repos.getCommit({
      owner,
      repo,
      ref: sha,
    })

    const commit = commitResponse.data
    const commitDate = new Date(commit.commit.author?.date || commit.commit.committer?.date || '')
    const commitAuthor = commit.author?.login || commit.commit.author?.name || 'unknown'

    const timeDiffMs = Math.abs(deploymentTime.getTime() - commitDate.getTime())
    const timeDifferenceMinutes = Math.round(timeDiffMs / (1000 * 60))
    const isWithinThreshold = timeDifferenceMinutes <= 30

    logger.info(`   📅 Commit date: ${commitDate.toISOString()}`)
    logger.info(`   📅 Deployment date: ${deploymentTime.toISOString()}`)
    logger.info(`   ⏱️  Time difference: ${timeDifferenceMinutes} minutes (threshold: 30)`)

    const { pr: prInfo } = await getPullRequestForCommit(owner, repo, sha, true)

    let reviewers: Array<{ username: string; state: string }> | undefined
    let prMergedAt: Date | undefined

    if (prInfo?.number) {
      const reviews = await getPullRequestReviews(owner, repo, prInfo.number)
      reviewers = reviews.map((r) => ({ username: r.user?.login || 'unknown', state: r.state }))
      if (prInfo.merged_at) {
        prMergedAt = new Date(prInfo.merged_at)
      }
    }

    return {
      success: true,
      data: {
        commitSha: sha,
        commitMessage: commit.commit.message.split('\n')[0], // First line only
        commitDate,
        commitAuthor,
        prNumber: prInfo?.number,
        prTitle: prInfo?.title,
        prUrl: prInfo?.html_url,
        prMergedAt,
        prAuthor: commit.author?.login,
        reviewers,
        timeDifferenceMinutes,
        isWithinThreshold,
      },
    }
  } catch (error) {
    logger.error(`Error looking up commit ${sha}:`, error)
    return {
      success: false,
      error: `Kunne ikke finne commit: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
    }
  }
}

export async function lookupLegacyByPR(
  owner: string,
  repo: string,
  prNumber: number,
  deploymentTime: Date,
): Promise<LegacyLookupResult> {
  try {
    const client = getGitHubClient()

    logger.info(`🔍 Legacy lookup: Fetching PR #${prNumber} in ${owner}/${repo}`)

    const prResponse = await client.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    })

    const pr = prResponse.data

    if (!pr.merged_at) {
      return {
        success: false,
        error: `PR #${prNumber} er ikke merget`,
      }
    }

    const prMergedAt = new Date(pr.merged_at)

    const timeDiffMs = Math.abs(deploymentTime.getTime() - prMergedAt.getTime())
    const timeDifferenceMinutes = Math.round(timeDiffMs / (1000 * 60))
    const isWithinThreshold = timeDifferenceMinutes <= 30

    logger.info(`   📅 PR merged at: ${prMergedAt.toISOString()}`)
    logger.info(`   📅 Deployment date: ${deploymentTime.toISOString()}`)
    logger.info(`   ⏱️  Time difference: ${timeDifferenceMinutes} minutes (threshold: 30)`)

    const reviews = await getPullRequestReviews(owner, repo, prNumber)
    const reviewers = reviews.map((r) => ({ username: r.user?.login || 'unknown', state: r.state }))

    const commitSha = pr.merge_commit_sha || ''
    const mergedBy = pr.merged_by?.login

    return {
      success: true,
      data: {
        commitSha,
        commitMessage: pr.title,
        commitDate: prMergedAt,
        commitAuthor: pr.user?.login || 'unknown',
        prNumber,
        prTitle: pr.title,
        prUrl: pr.html_url,
        prMergedAt,
        prAuthor: pr.user?.login,
        mergedBy,
        reviewers,
        timeDifferenceMinutes,
        isWithinThreshold,
      },
    }
  } catch (error) {
    logger.error(`Error looking up PR #${prNumber}:`, error)
    return {
      success: false,
      error: `Kunne ikke finne PR: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
    }
  }
}
