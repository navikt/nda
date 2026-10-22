import type { PoolClient } from 'pg'
import { isFullCommitSha } from '~/lib/git-constants'
import type {
  RepositoryDeliveryAssociatedPullRequestSnapshot,
  RepositoryDeliveryIntervalAssessment,
  RepositoryDeliveryIntervalCompare,
  RepositoryDeliveryPullRequestEvidence,
  RepositoryDeliveryStackAncestryStatus,
} from '~/lib/repository-code-delivery/interval-assessment'
import { assessRepositoryDeliveryInterval } from '~/lib/repository-code-delivery/interval-assessment'
import type { PrCommit, PrReview } from '~/lib/verification/types'
import { isImplicitApprovalMode } from '~/lib/verification/types'
import { withTransaction } from './connection.server'

interface IntervalSnapshotSources {
  comparisons: Array<{ id: number; fetchedAt: string }>
  associations: Array<{ id: number; fetchedAt: string }>
  pullRequests: Array<{ id: number; fetchedAt: string }>
  stackComparisons: Array<{ id: number; fetchedAt: string }>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isPrReviewState(value: unknown): value is PrReview['state'] {
  return (
    value === 'APPROVED' ||
    value === 'CHANGES_REQUESTED' ||
    value === 'COMMENTED' ||
    value === 'PENDING' ||
    value === 'DISMISSED'
  )
}

function parseCommitShas(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const shas = value.map((item) => {
    const parent = asRecord(item)
    return typeof parent?.sha === 'string' && isFullCommitSha(parent.sha) ? parent.sha : null
  })
  return shas.every((sha): sha is string => sha !== null) ? shas : null
}

function parseCompareData(value: unknown): RepositoryDeliveryIntervalCompare | null {
  const compare = asRecord(value)
  if (
    !compare ||
    typeof compare.status !== 'string' ||
    !isSafeInteger(compare.ahead_by) ||
    !isSafeInteger(compare.behind_by) ||
    !isSafeInteger(compare.total_commits) ||
    compare.total_commits < 0 ||
    !Array.isArray(compare.commits)
  ) {
    return null
  }

  const commits: RepositoryDeliveryIntervalCompare['commits'] = []
  for (const item of compare.commits) {
    const commit = asRecord(item)
    const commitData = asRecord(commit?.commit)
    const authorData = asRecord(commitData?.author)
    const committerData = asRecord(commitData?.committer)
    const author = asRecord(commit?.author)
    const parents = parseCommitShas(commit?.parents)
    if (
      !commit ||
      !commitData ||
      typeof commit.sha !== 'string' ||
      !isFullCommitSha(commit.sha) ||
      typeof commitData.message !== 'string' ||
      !parents
    ) {
      return null
    }

    commits.push({
      sha: commit.sha,
      message: commitData.message,
      authorLogin: typeof author?.login === 'string' ? author.login : null,
      authorUsername:
        typeof author?.login === 'string'
          ? author.login
          : typeof authorData?.name === 'string'
            ? authorData.name
            : 'unknown',
      authorDate: typeof authorData?.date === 'string' ? authorData.date : '',
      committerDate: typeof committerData?.date === 'string' ? committerData.date : '',
      parentShas: parents,
      isMergeCommit: parents.length > 1,
      htmlUrl: typeof commit.html_url === 'string' ? commit.html_url : '',
    })
  }

  return {
    status: compare.status,
    aheadBy: compare.ahead_by,
    behindBy: compare.behind_by,
    totalCommits: compare.total_commits,
    commits,
  }
}

function parseAssociatedPullRequests(
  value: unknown,
  paginationComplete: boolean,
): RepositoryDeliveryAssociatedPullRequestSnapshot {
  if (!paginationComplete || !Array.isArray(value)) return { complete: false, pullRequests: [] }
  const pullRequests: RepositoryDeliveryAssociatedPullRequestSnapshot['pullRequests'] = []

  for (const item of value) {
    const pullRequest = asRecord(item)
    const base = asRecord(pullRequest?.base)
    if (!pullRequest || !base || !isSafeInteger(pullRequest.number) || typeof base.ref !== 'string') {
      return { complete: false, pullRequests: [] }
    }
    pullRequests.push({ number: pullRequest.number, baseBranch: base.ref })
  }

  return { complete: true, pullRequests }
}

function parsePullRequestCommits(value: unknown): PrCommit[] | null {
  if (!Array.isArray(value)) return null
  const commits: PrCommit[] = []
  for (const item of value) {
    const commit = asRecord(item)
    const commitData = asRecord(commit?.commit)
    const author = asRecord(commit?.author)
    const commitAuthor = asRecord(commitData?.author)
    const committer = asRecord(commitData?.committer)
    const parentShas = parseCommitShas(commit?.parents)
    if (
      !commit ||
      !commitData ||
      typeof commit.sha !== 'string' ||
      !isFullCommitSha(commit.sha) ||
      typeof commitData.message !== 'string' ||
      !parentShas
    ) {
      return null
    }

    commits.push({
      sha: commit.sha,
      message: commitData.message,
      authorUsername:
        typeof author?.login === 'string'
          ? author.login
          : typeof commitAuthor?.name === 'string'
            ? commitAuthor.name
            : 'unknown',
      authorLogin: typeof author?.login === 'string' ? author.login : null,
      authorDate: typeof commitAuthor?.date === 'string' ? commitAuthor.date : '',
      committerDate:
        typeof committer?.date === 'string'
          ? committer.date
          : typeof commitAuthor?.date === 'string'
            ? commitAuthor.date
            : '',
      isMergeCommit: parentShas.length > 1,
      parentShas,
    })
  }
  return commits
}

function parsePullRequestReviews(value: unknown): PrReview[] | null {
  if (!Array.isArray(value)) return null
  const reviews: PrReview[] = []
  for (const item of value) {
    const review = asRecord(item)
    if (!review || !isPrReviewState(review.state)) return null
    const user = asRecord(review.user)
    if (!user || typeof user.login !== 'string' || typeof review.submitted_at !== 'string') continue
    reviews.push({
      id: isSafeInteger(review.id) ? review.id : 0,
      username: user.login,
      state: review.state,
      submittedAt: review.submitted_at,
      body: null,
      commitId: typeof review.commit_id === 'string' ? review.commit_id : null,
    })
  }
  return reviews
}

function parsePullRequestEvidence(
  prNumber: number,
  snapshots: Partial<Record<'pr' | 'reviews' | 'commits', unknown>>,
): RepositoryDeliveryPullRequestEvidence | null {
  const metadata = asRecord(snapshots.pr)
  const base = asRecord(metadata?.base)
  const head = asRecord(metadata?.head)
  if (
    !metadata ||
    metadata.number !== prNumber ||
    typeof base?.ref !== 'string' ||
    typeof head?.sha !== 'string' ||
    !isFullCommitSha(head.sha) ||
    !isSafeInteger(metadata.commits) ||
    metadata.commits < 0
  ) {
    return null
  }

  const commits = parsePullRequestCommits(snapshots.commits)
  const reviews = parsePullRequestReviews(snapshots.reviews)
  if (!commits || !reviews) return null

  const author = asRecord(metadata.user)
  const mergedBy = asRecord(metadata.merged_by)
  return {
    number: prNumber,
    baseBranch: base.ref,
    baseSha: typeof base.sha === 'string' ? base.sha : null,
    authorLogin: typeof author?.login === 'string' ? author.login : null,
    mergedByLogin: typeof mergedBy?.login === 'string' ? mergedBy.login : null,
    mergeCommitSha: typeof metadata.merge_commit_sha === 'string' ? metadata.merge_commit_sha : null,
    mergedAt: typeof metadata.merged_at === 'string' ? metadata.merged_at : null,
    headBranch: typeof head.ref === 'string' ? head.ref : null,
    headSha: head.sha,
    commitCount: metadata.commits,
    commits,
    reviews,
  }
}

async function getRepositoryCodeDeliveryIntervalAssessmentsInTransaction(
  client: Pick<PoolClient, 'query'>,
  repositoryId: number,
  deliveries: Array<{ id: number; base_sha: string; head_sha: string }>,
): Promise<
  Array<{
    deliveryId: number
    assessment: RepositoryDeliveryIntervalAssessment
    pullRequestNumbers: number[]
    evidence: Parameters<typeof assessRepositoryDeliveryInterval>[0]
    sources: IntervalSnapshotSources
  }>
> {
  if (deliveries.length === 0) return []

  const { rows: repositoryRows } = await client.query<{
    github_repo_id: string
    default_branch: string | null
    implicit_approval_mode: string
  }>(
    `SELECT github_repo_id, default_branch, implicit_approval_mode
     FROM repositories
     WHERE id = $1`,
    [repositoryId],
  )
  const repository = repositoryRows[0]
  if (!repository || !isImplicitApprovalMode(repository.implicit_approval_mode)) {
    throw new Error(`Repository ${repositoryId} is missing or has an invalid implicit approval mode`)
  }
  const implicitApprovalMode = repository.implicit_approval_mode

  const deliveryIds = deliveries.map((delivery) => delivery.id)
  const { rows: compareRows } = await client.query<{
    delivery_id: number
    data: unknown
    id: number | null
    fetched_at: Date | null
  }>(
    `SELECT delivery.id AS delivery_id, snapshot.data, snapshot.id, snapshot.fetched_at
     FROM repository_code_deliveries delivery
     LEFT JOIN LATERAL (
       SELECT id, fetched_at, data
       FROM github_compare_raw_snapshots
       WHERE github_repo_id = $1
         AND lower(base_sha) = lower(delivery.base_sha)
         AND lower(head_sha) = lower(delivery.head_sha)
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1
     ) snapshot ON true
     WHERE delivery.repository_id = $2
       AND delivery.id = ANY($3::int[])`,
    [repository.github_repo_id, repositoryId, deliveryIds],
  )
  const compareByDeliveryId = new Map(compareRows.map((row) => [row.delivery_id, parseCompareData(row.data)]))
  const commitShas = [
    ...new Set(
      [...compareByDeliveryId.values()].flatMap((compare) => compare?.commits.map((commit) => commit.sha) ?? []),
    ),
  ]
  const { rows: associatedRows } =
    commitShas.length === 0
      ? { rows: [] }
      : await client.query<{ sha: string; data: unknown; pagination_complete: boolean; id: number; fetched_at: Date }>(
          `SELECT DISTINCT ON (sha) sha, data, pagination_complete, id, fetched_at
           FROM github_commit_associated_prs_raw_snapshots
           WHERE github_repo_id = $1
             AND sha = ANY($2::text[])
           ORDER BY sha, fetched_at DESC, id DESC`,
          [repository.github_repo_id, commitShas],
        )
  const associatedPullRequestsBySha = new Map(
    associatedRows.map((row) => [row.sha, parseAssociatedPullRequests(row.data, row.pagination_complete)]),
  )
  const associatedPullRequestNumbers = [
    ...new Set(
      [...associatedPullRequestsBySha.values()].flatMap((snapshot) =>
        snapshot.pullRequests.map((pullRequest) => pullRequest.number),
      ),
    ),
  ]
  const { rows: stackedPullRequestRows } = await client.query<{ delivery_id: number; pull_request_number: string }>(
    `SELECT sync.delivery_id, pr_number AS pull_request_number
     FROM repository_code_delivery_assessment_sync sync
     CROSS JOIN LATERAL jsonb_object_keys(sync.completed_pull_request_snapshot_ids) AS pr_numbers(pr_number)
     WHERE sync.delivery_id = ANY($1::int[])`,
    [deliveryIds],
  )
  const { rows: stackParentRows } = await client.query<{
    delivery_id: number
    child_pull_request_number: string
    parent_pull_request_numbers: number[]
  }>(
    `SELECT sync.delivery_id,
            parent_map.key AS child_pull_request_number,
            parent_map.value AS parent_pull_request_numbers
     FROM repository_code_delivery_assessment_sync sync
     CROSS JOIN LATERAL jsonb_each(sync.stack_parent_pull_request_numbers) AS parent_map(key, value)
     WHERE sync.delivery_id = ANY($1::int[])`,
    [deliveryIds],
  )
  const pullRequestNumbers = [
    ...new Set([
      ...associatedPullRequestNumbers,
      ...stackedPullRequestRows
        .map((row) => Number(row.pull_request_number))
        .filter((number) => Number.isSafeInteger(number) && number > 0),
    ]),
  ]
  const { rows: pullRequestRows } =
    pullRequestNumbers.length === 0
      ? { rows: [] }
      : await client.query<{
          pr_number: number
          data_type: 'pr' | 'reviews' | 'commits'
          data: unknown
          id: number
          fetched_at: Date
        }>(
          `SELECT DISTINCT ON (pr_number, data_type) pr_number, data_type, data, id, fetched_at
           FROM github_pr_raw_snapshots
           WHERE github_repo_id = $1
             AND pr_number = ANY($2::int[])
             AND data_type = ANY($3::text[])
           ORDER BY pr_number, data_type, fetched_at DESC, id DESC`,
          [repository.github_repo_id, pullRequestNumbers, ['pr', 'reviews', 'commits']],
        )

  const rawPullRequests = new Map<number, Partial<Record<'pr' | 'reviews' | 'commits', unknown>>>()
  for (const row of pullRequestRows) {
    const snapshots = rawPullRequests.get(row.pr_number) ?? {}
    snapshots[row.data_type] = row.data
    rawPullRequests.set(row.pr_number, snapshots)
  }
  const pullRequestsByNumber = Object.fromEntries(
    pullRequestNumbers.map((prNumber) => [
      prNumber,
      parsePullRequestEvidence(prNumber, rawPullRequests.get(prNumber) ?? {}),
    ]),
  )
  const stackAncestryPairs = stackParentRows.flatMap((row) => {
    const child = pullRequestsByNumber[Number(row.child_pull_request_number)]
    const childMergeCommitSha = child?.mergeCommitSha
    if (!childMergeCommitSha) return []
    return row.parent_pull_request_numbers.flatMap((parentNumber) => {
      const parent = pullRequestsByNumber[parentNumber]
      const parentHeadSha = parent?.headSha
      return parentHeadSha
        ? [
            {
              deliveryId: row.delivery_id,
              childNumber: Number(row.child_pull_request_number),
              parentNumber,
              baseSha: childMergeCommitSha,
              headSha: parentHeadSha,
            },
          ]
        : []
    })
  })
  const { rows: stackAncestryRows } =
    stackAncestryPairs.length === 0
      ? { rows: [] }
      : await client.query<{ base_sha: string; head_sha: string; data: unknown; id: number; fetched_at: Date }>(
          `SELECT DISTINCT ON (lower(snapshot.base_sha), lower(snapshot.head_sha))
                  snapshot.base_sha, snapshot.head_sha, snapshot.data, snapshot.id, snapshot.fetched_at
           FROM github_compare_raw_snapshots snapshot
           WHERE snapshot.github_repo_id = $1
             AND (lower(snapshot.base_sha), lower(snapshot.head_sha)) IN (
               SELECT lower(pair.base_sha), lower(pair.head_sha)
               FROM unnest($2::text[], $3::text[]) AS pair(base_sha, head_sha)
             )
           ORDER BY lower(snapshot.base_sha), lower(snapshot.head_sha), snapshot.fetched_at DESC, snapshot.id DESC`,
          [
            repository.github_repo_id,
            stackAncestryPairs.map((pair) => pair.baseSha),
            stackAncestryPairs.map((pair) => pair.headSha),
          ],
        )
  const stackAncestryBySha = new Map<string, RepositoryDeliveryStackAncestryStatus>()
  for (const row of stackAncestryRows) {
    const status = asRecord(row.data)?.status
    if (status === 'identical' || status === 'ahead' || status === 'behind' || status === 'diverged') {
      stackAncestryBySha.set(`${row.base_sha.toLowerCase()}:${row.head_sha.toLowerCase()}`, status)
    }
  }

  return deliveries.map((delivery) => {
    const compare = compareByDeliveryId.get(delivery.id) ?? null
    const pullRequestNumbers = [
      ...new Set([
        ...(compare?.commits ?? []).flatMap(
          (commit) =>
            associatedPullRequestsBySha.get(commit.sha)?.pullRequests.map((pullRequest) => pullRequest.number) ?? [],
        ),
        ...stackedPullRequestRows
          .filter((row) => row.delivery_id === delivery.id)
          .map((row) => Number(row.pull_request_number))
          .filter((number) => Number.isSafeInteger(number) && number > 0),
      ]),
    ]
    const associatedPullRequestsByCommit = Object.fromEntries(
      (compare?.commits ?? []).flatMap((commit) => {
        const associations = associatedPullRequestsBySha.get(commit.sha)
        return associations ? [[commit.sha, associations]] : []
      }),
    )
    const deliveryPullRequestsByNumber = Object.fromEntries(
      pullRequestNumbers.map((pullRequestNumber) => [pullRequestNumber, pullRequestsByNumber[pullRequestNumber]]),
    )
    const stackParentPullRequestNumbersByNumber = Object.fromEntries(
      stackParentRows
        .filter((row) => row.delivery_id === delivery.id)
        .map((row) => [Number(row.child_pull_request_number), row.parent_pull_request_numbers]),
    )
    const stackAncestryByPullRequestNumber: Record<number, Record<number, RepositoryDeliveryStackAncestryStatus>> = {}
    for (const pair of stackAncestryPairs.filter((candidate) => candidate.deliveryId === delivery.id)) {
      const ancestry = stackAncestryBySha.get(`${pair.baseSha.toLowerCase()}:${pair.headSha.toLowerCase()}`)
      if (!ancestry) continue
      const parents = stackAncestryByPullRequestNumber[pair.childNumber] ?? {}
      parents[pair.parentNumber] = ancestry
      stackAncestryByPullRequestNumber[pair.childNumber] = parents
    }
    const evidence = {
      compare,
      defaultBranch: repository.default_branch,
      implicitApprovalMode,
      associatedPullRequestsByCommit,
      pullRequestsByNumber: deliveryPullRequestsByNumber,
      stackParentPullRequestNumbersByNumber,
      stackAncestryByPullRequestNumber,
    }
    const assessment = assessRepositoryDeliveryInterval(evidence)
    const comparison = compareRows.find((row) => row.delivery_id === delivery.id)
    const deliveryShas = new Set(compare?.commits.map((commit) => commit.sha) ?? [])
    const ancestryPairs = new Set(
      stackAncestryPairs
        .filter((pair) => pair.deliveryId === delivery.id)
        .map((pair) => `${pair.baseSha.toLowerCase()}:${pair.headSha.toLowerCase()}`),
    )
    const snapshotReference = (row: { id: number; fetched_at: Date }) => ({
      id: row.id,
      fetchedAt: row.fetched_at.toISOString(),
    })
    const sources: IntervalSnapshotSources = {
      comparisons:
        comparison?.id != null && comparison.fetched_at
          ? [{ id: comparison.id, fetchedAt: comparison.fetched_at.toISOString() }]
          : [],
      associations: associatedRows.filter((row) => deliveryShas.has(row.sha)).map(snapshotReference),
      pullRequests: pullRequestRows.filter((row) => pullRequestNumbers.includes(row.pr_number)).map(snapshotReference),
      stackComparisons: stackAncestryRows
        .filter((row) => ancestryPairs.has(`${row.base_sha.toLowerCase()}:${row.head_sha.toLowerCase()}`))
        .map(snapshotReference),
    }
    return {
      deliveryId: delivery.id,
      assessment,
      pullRequestNumbers,
      evidence,
      sources,
    }
  })
}

export async function getRepositoryCodeDeliveryIntervalAssessments(
  repositoryId: number,
  deliveries: Array<{ id: number; base_sha: string; head_sha: string }>,
  client?: Pick<PoolClient, 'query'>,
): Promise<
  Array<{
    deliveryId: number
    assessment: RepositoryDeliveryIntervalAssessment
    pullRequestNumbers: number[]
    evidence: Parameters<typeof assessRepositoryDeliveryInterval>[0]
    sources: IntervalSnapshotSources
  }>
> {
  if (deliveries.length === 0) return []
  if (client) return getRepositoryCodeDeliveryIntervalAssessmentsInTransaction(client, repositoryId, deliveries)

  return withTransaction(async (transactionClient) => {
    await transactionClient.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    return getRepositoryCodeDeliveryIntervalAssessmentsInTransaction(transactionClient, repositoryId, deliveries)
  })
}
