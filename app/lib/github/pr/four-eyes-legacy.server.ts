import { isDependabotUser } from '~/lib/dependabot'
import { logger } from '~/lib/logger.server'
import { getGitHubClient } from '../client.server'

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
