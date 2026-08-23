import {
  getAllLatestPrSnapshots,
  getLatestCompareSnapshot,
  saveCommitSnapshot,
  saveCompareSnapshot,
} from '~/db/github-data.server'
import { getCommitsBetween, haveSameCommitTree } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { type FetchOptions, fetchPrFromGitHub, findPrForCommit, persistPrSnapshots } from '../fetch-data/pr-data.server'
import type { CompareData, CompareSummary, PrCommit, PrMetadata, PrReview, VerificationInput } from '../types'

export function resolveNoDiffDetection(
  compareData: CompareData,
  fromSha: string,
  toSha: string,
  hasSameTree: boolean | null,
): { noDiffDetected: boolean; shouldPersistCompare: boolean } {
  const isEmptyCompare = compareData.commits.length === 0 && compareData.compare.changedFiles === 0
  const shouldTryTreeFallback = isEmptyCompare && compareData.compare.status !== 'identical' && fromSha !== toSha
  const noDiffDetected = isEmptyCompare && (compareData.compare.status === 'identical' || hasSameTree === true)
  const shouldPersistCompare = !shouldTryTreeFallback || hasSameTree !== null
  return { noDiffDetected, shouldPersistCompare }
}

export async function fetchCommitsBetween(
  owner: string,
  repo: string,
  fromSha: string,
  toSha: string,
  baseBranch: string,
  _previousDeploymentDate: string,
  options?: FetchOptions,
): Promise<{ commitsBetween: VerificationInput['commitsBetween']; compareSummary: CompareSummary } | null> {
  if (!options?.forceRefresh) {
    const cachedCompare = await getLatestCompareSnapshot(owner, repo, fromSha, toSha)
    if (cachedCompare) {
      logger.info(
        `   📦 Using cached compare data (${cachedCompare.data.commits.length} commits, ${cachedCompare.data.compare.changedFiles} files)`,
      )
      return {
        commitsBetween: await buildCommitsBetweenFromCache(owner, repo, baseBranch, cachedCompare.data, options),
        compareSummary: cachedCompare.data.compare,
      }
    }
  }

  logger.info(`   🌐 Fetching compare from GitHub: ${fromSha.substring(0, 7)}...${toSha.substring(0, 7)}`)
  const compareData = await getCommitsBetween(owner, repo, fromSha, toSha)

  if (!compareData) {
    logger.warn(`Could not fetch commits between ${fromSha} and ${toSha}`)
    return null
  }

  const isEmptyCompare = compareData.commits.length === 0 && compareData.compare.changedFiles === 0
  const shouldTryTreeFallback = isEmptyCompare && compareData.compare.status !== 'identical' && fromSha !== toSha
  let hasSameTree: boolean | null = null
  if (shouldTryTreeFallback) {
    hasSameTree = await haveSameCommitTree(owner, repo, fromSha, toSha)
  }

  const { noDiffDetected, shouldPersistCompare } = resolveNoDiffDetection(compareData, fromSha, toSha, hasSameTree)

  const storedCompareData: CompareData = {
    ...compareData,
    compare: {
      ...compareData.compare,
      noDiffDetected,
    },
  }

  if (shouldPersistCompare) {
    await saveCompareSnapshot(owner, repo, fromSha, toSha, storedCompareData)
  } else {
    logger.warn(
      `Skipping compare snapshot cache for ${fromSha.substring(0, 7)}...${toSha.substring(0, 7)}: tree fallback inconclusive`,
    )
  }

  for (const commit of storedCompareData.commits) {
    await saveCommitSnapshot(owner, repo, commit.sha, 'metadata', commit)
  }

  return {
    commitsBetween: await buildCommitsBetweenFromCache(owner, repo, baseBranch, storedCompareData, options),
    compareSummary: storedCompareData.compare,
  }
}

const COMMIT_CONCURRENCY_LIMIT = 10

export async function buildCommitsBetweenFromCache(
  owner: string,
  repo: string,
  baseBranch: string,
  compareData: CompareData,
  options?: FetchOptions & { cacheOnly?: boolean },
): Promise<VerificationInput['commitsBetween']> {
  const cacheOnly = options?.cacheOnly ?? false
  const prFetchCache = new Map<number, Promise<Awaited<ReturnType<typeof fetchPrFromGitHub>>>>()

  const processCommit = async (commit: CompareData['commits'][0]) => {
    const { prNumber, mismatchedBaseBranches, mismatchedPrNumbers } = await findPrForCommit(
      owner,
      repo,
      commit.sha,
      baseBranch,
      { cacheOnly, forceRefresh: options?.forceRefresh },
    )

    let prData: VerificationInput['commitsBetween'][0]['pr'] = null

    if (prNumber && !options?.forceRefresh) {
      const cachedData = await getAllLatestPrSnapshots(owner, repo, prNumber)

      if (cachedData.has('metadata') && cachedData.has('reviews') && cachedData.has('commits')) {
        const metadata = cachedData.get('metadata')?.data as PrMetadata
        const reviews = cachedData.get('reviews')?.data as PrReview[]
        const prCommits = cachedData.get('commits')?.data as PrCommit[]

        prData = {
          number: prNumber,
          title: metadata.title,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          reviews,
          commits: prCommits,
          baseBranch: metadata.baseBranch,
          mergedBy: metadata.mergedBy?.username ?? null,
          prCreator: metadata.author.username === 'unknown' ? undefined : metadata.author.username,
        }
      }
    }

    if (prNumber && !prData && !cacheOnly) {
      let prFetch = prFetchCache.get(prNumber)
      if (!prFetch) {
        prFetch = fetchPrFromGitHub(owner, repo, prNumber)
          .then(async (data) => {
            await persistPrSnapshots(owner, repo, prNumber, data)
            return data
          })
          .catch((error) => {
            prFetchCache.delete(prNumber)
            throw error
          })
        prFetchCache.set(prNumber, prFetch)
      }
      try {
        const { metadata, reviews, commits: prCommits } = await prFetch
        prData = {
          number: prNumber,
          title: metadata.title,
          url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
          reviews,
          commits: prCommits,
          baseBranch: metadata.baseBranch,
          mergedBy: metadata.mergedBy?.username ?? null,
          prCreator: metadata.author.username === 'unknown' ? undefined : metadata.author.username,
        }
      } catch (error) {
        logger.warn(`Failed to fetch PR #${prNumber} for commit ${commit.sha}: ${error}`)
      }
    }

    return {
      sha: commit.sha,
      message: commit.message,
      authorUsername: commit.authorUsername,
      authorDate: commit.authorDate,
      isMergeCommit: commit.isMergeCommit,
      parentShas: commit.parentShas,
      htmlUrl: commit.htmlUrl,
      pr: prData,
      mismatchedBaseBranches: mismatchedBaseBranches.length > 0 ? mismatchedBaseBranches : undefined,
      mismatchedPrNumbers: mismatchedPrNumbers.length > 0 ? mismatchedPrNumbers : undefined,
    }
  }

  const results: VerificationInput['commitsBetween'] = []
  for (let i = 0; i < compareData.commits.length; i += COMMIT_CONCURRENCY_LIMIT) {
    const batch = compareData.commits.slice(i, i + COMMIT_CONCURRENCY_LIMIT)
    const batchResults = await Promise.all(batch.map(processCommit))
    results.push(...batchResults)
  }
  return results
}
