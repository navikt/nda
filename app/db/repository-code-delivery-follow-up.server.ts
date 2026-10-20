import type { PoolClient } from 'pg'
import { chunk } from '~/lib/chunk'
import {
  assessStoredRepositoryDeliveryApproval,
  type RepositoryDeliveryApprovalAssessment,
} from '~/lib/repository-code-delivery/approval-assessment'
import { getRepositoryCodeDeliveryIntervalAssessments } from './repository-code-delivery-interval-assessment.server'
import {
  listRepositoryCodeDeliveries,
  type RepositoryCodeDeliverySortDirection,
  type RepositoryCodeDeliverySortKey,
} from './repository-code-delivery-overview.server'
import { getRepositoryManualApprovalCommits } from './repository-manual-approval-commits.server'
import { getGithubUserLookups } from './user-github-lookups.server'

export async function getRepositoryCodeDeliveryFollowUp(
  repositoryId: number,
  options: {
    page: number
    pageSize: number
    status: RepositoryDeliveryApprovalAssessment['status'] | 'all'
    sort?: { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection }
  },
  client: PoolClient,
) {
  const deliveries = await listRepositoryCodeDeliveries(
    repositoryId,
    { limit: null, offset: 0, sort: options.sort },
    client,
  )
  const summaries = []
  const counts = { approved: 0, not_approved: 0, incomplete: 0, no_changes: 0 }
  for (const batch of chunk(deliveries, 100)) {
    const assessments = await getRepositoryCodeDeliveryIntervalAssessments(repositoryId, batch, client)
    const manualCommits = await getRepositoryManualApprovalCommits(
      client,
      repositoryId,
      batch.map((delivery) => delivery.id),
    )
    const usernames = [
      ...new Set(
        assessments.flatMap(({ assessment }) =>
          assessment.commits.flatMap((commit) => (commit.authorLogin ? [commit.authorLogin] : [])),
        ),
      ),
    ]
    const lookups = await getGithubUserLookups(usernames, client)
    const identities = new Map(
      [...lookups].map(([username, lookup]) => [
        username,
        lookup.account_deleted_at === null ? lookup.active_nav_ident : null,
      ]),
    )
    const assessmentsById = new Map(assessments.map((item) => [item.deliveryId, item]))
    const historyById = new Map<number, typeof manualCommits>()
    for (const commit of manualCommits) {
      const history = historyById.get(commit.delivery_id) ?? []
      history.push(commit)
      historyById.set(commit.delivery_id, history)
    }
    for (const delivery of batch) {
      const evidence = assessmentsById.get(delivery.id)
      if (!evidence) throw new Error(`Missing interval assessment for delivery ${delivery.id}`)
      const approval = assessStoredRepositoryDeliveryApproval(
        delivery,
        evidence.assessment,
        historyById.get(delivery.id) ?? [],
        identities,
      )
      counts[approval.status]++
      const { state, totalCommits, listedCommits, summary } = evidence.assessment
      summaries.push({
        ...delivery,
        assessment: { state, totalCommits, listedCommits, summary },
        pullRequestNumbers: evidence.pullRequestNumbers,
        followUp: {
          status: approval.status,
          covered: approval.commits.filter((commit) => commit.status === 'covered').length,
          needsApproval: approval.commits.filter((commit) => commit.status === 'not_covered').length,
          unknown: approval.commits.filter((commit) => commit.status === 'unknown').length + approval.omittedCommits,
        },
      })
    }
  }
  const filtered =
    options.status === 'all' ? summaries : summaries.filter((delivery) => delivery.followUp.status === options.status)
  const totalPages = Math.max(1, Math.ceil(filtered.length / options.pageSize))
  const page = Math.min(options.page, totalPages)
  return {
    deliveries: filtered.slice((page - 1) * options.pageSize, page * options.pageSize),
    counts,
    total: filtered.length,
    page,
    totalPages,
  }
}
