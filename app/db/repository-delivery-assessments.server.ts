import type { PoolClient } from 'pg'
import { assessStoredRepositoryDeliveryApproval } from '~/lib/repository-code-delivery/approval-assessment'
import { getRepositoryCodeDeliveryIntervalAssessments } from './repository-code-delivery-interval-assessment.server'
import { getRepositoryManualApprovalCommits } from './repository-manual-approval-commits.server'
import { getGithubUserLookups } from './user-github-lookups.server'

export async function getStoredRepositoryDeliveryAssessments(
  client: Pick<PoolClient, 'query'>,
  repositoryId: number,
  deliveries: Array<{ id: number; base_sha: string; head_sha: string }>,
  additionalUsernames: string[] = [],
) {
  const intervals = await getRepositoryCodeDeliveryIntervalAssessments(repositoryId, deliveries, client)
  const history = await getRepositoryManualApprovalCommits(
    client,
    repositoryId,
    deliveries.map((delivery) => delivery.id),
  )
  const usernames = [
    ...new Set([
      ...additionalUsernames,
      ...intervals.flatMap(({ assessment }) =>
        assessment.commits.flatMap((commit) => (commit.authorLogin ? [commit.authorLogin] : [])),
      ),
    ]),
  ]
  const lookups = await getGithubUserLookups(usernames, client)
  const identities = new Map(
    [...lookups].map(([username, lookup]) => [
      username,
      lookup.account_deleted_at === null ? lookup.active_nav_ident : null,
    ]),
  )
  const intervalsById = new Map(intervals.map((interval) => [interval.deliveryId, interval.assessment]))
  const assessments = new Map(
    deliveries.map((delivery) => {
      const interval = intervalsById.get(delivery.id)
      if (!interval) throw new Error(`Missing interval assessment for delivery ${delivery.id}`)
      return [
        delivery.id,
        {
          interval,
          assessment: assessStoredRepositoryDeliveryApproval(
            delivery,
            interval,
            history.filter((approval) => approval.delivery_id === delivery.id),
            identities,
          ),
        },
      ] as const
    }),
  )
  return { assessments, lookups }
}
