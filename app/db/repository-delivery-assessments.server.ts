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
      ...intervals.flatMap(({ evidence }) =>
        Object.values(evidence?.pullRequestsByNumber ?? {}).flatMap((pullRequest) =>
          pullRequest
            ? [
                pullRequest.authorLogin,
                pullRequest.mergedByLogin,
                ...(pullRequest.reviews ?? []).map((review) => review.username),
              ].filter((username): username is string => typeof username === 'string' && username.length > 0)
            : [],
        ),
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
  const intervalsById = new Map(intervals.map((interval) => [interval.deliveryId, interval]))
  const assessments = new Map(
    deliveries.map((delivery) => {
      const evaluated = intervalsById.get(delivery.id)
      if (!evaluated) throw new Error(`Missing interval assessment for delivery ${delivery.id}`)
      const interval = evaluated.assessment
      const manualApprovals = history.filter((approval) => approval.delivery_id === delivery.id)
      return [
        delivery.id,
        {
          interval,
          evidence: evaluated.evidence,
          sources: evaluated.sources,
          manualApprovals,
          assessment: assessStoredRepositoryDeliveryApproval(delivery, interval, manualApprovals, identities),
        },
      ] as const
    }),
  )
  return { assessments, lookups }
}
