import type { PoolClient } from 'pg'
import { getStoredRepositoryDeliveryAssessments } from './repository-delivery-assessments.server'

export async function getRepositoryAssessmentDiagnostic(
  client: Pick<PoolClient, 'query'>,
  repositoryId: number,
  githubRepoId: string,
  deliveries: Array<{ id: number; base_sha: string; head_sha: string }>,
) {
  if (deliveries.length === 0) return []
  const { assessments, lookups } = await getStoredRepositoryDeliveryAssessments(client, repositoryId, deliveries)
  const entries = deliveries.map((delivery) => {
    const evaluated = assessments.get(delivery.id)
    if (!evaluated) throw new Error(`Missing diagnostic assessment for delivery ${delivery.id}`)
    return { delivery, ...evaluated }
  })
  const comparisonIds = new Set<number>()
  const associationIds = new Set<number>()
  const prIds = new Set<number>()
  for (const { sources } of entries) {
    for (const reference of [...sources.comparisons, ...sources.stackComparisons]) comparisonIds.add(reference.id)
    for (const reference of sources.associations) associationIds.add(reference.id)
    for (const reference of sources.pullRequests) prIds.add(reference.id)
  }
  const [comparisons, associations, pullRequests, sync] = await Promise.all([
    client.query<{ id: number; snapshot: unknown }>(
      `SELECT snapshot.id, to_jsonb(snapshot) AS snapshot
       FROM github_compare_raw_snapshots snapshot
       WHERE github_repo_id = $1 AND id = ANY($2::int[])
       ORDER BY id`,
      [githubRepoId, [...comparisonIds]],
    ),
    client.query<{ id: number; snapshot: unknown }>(
      `SELECT snapshot.id, to_jsonb(snapshot) AS snapshot
       FROM github_commit_associated_prs_raw_snapshots snapshot
       WHERE github_repo_id = $1 AND id = ANY($2::int[])
       ORDER BY id`,
      [githubRepoId, [...associationIds]],
    ),
    client.query<{ id: number; snapshot: unknown }>(
      `SELECT snapshot.id, to_jsonb(snapshot) AS snapshot
       FROM github_pr_raw_snapshots snapshot
       WHERE github_repo_id = $1 AND id = ANY($2::int[])
       ORDER BY id`,
      [githubRepoId, [...prIds]],
    ),
    client.query<{ delivery_id: number; state: unknown }>(
      `SELECT sync.delivery_id, to_jsonb(sync) AS state
       FROM repository_code_delivery_assessment_sync sync
       JOIN repository_code_deliveries delivery ON delivery.id = sync.delivery_id
       WHERE delivery.repository_id = $1 AND delivery.id = ANY($2::int[])
       ORDER BY sync.delivery_id`,
      [repositoryId, deliveries.map((delivery) => delivery.id)],
    ),
  ])
  const snapshots = (
    rows: Array<{ id: number; snapshot: unknown }>,
    references: Array<{ id: number; fetchedAt: string }>,
  ) =>
    references.map((reference) => {
      const row = rows.find((row) => row.id === reference.id)
      if (!row) throw new Error(`Missing referenced diagnostic snapshot ${reference.id}`)
      return row.snapshot
    })
  return entries.map(({ delivery, interval, assessment, evidence, sources, manualApprovals }) => ({
    deliveryId: delivery.id,
    baseSha: delivery.base_sha,
    headSha: delivery.head_sha,
    intervalAssessment: interval,
    approvalAssessment: assessment,
    evaluationInput: evidence,
    authorIdentities: interval.commits.flatMap((commit) => {
      if (!commit.authorLogin) return []
      const lookup = lookups.get(commit.authorLogin)
      return [
        {
          githubUsername: commit.authorLogin,
          activeNavIdent: lookup?.account_deleted_at === null ? lookup.active_nav_ident : null,
        },
      ]
    }),
    manualApprovalHistory: manualApprovals,
    snapshotReferences: sources,
    snapshots: {
      comparisons: snapshots(comparisons.rows, sources.comparisons),
      associations: snapshots(associations.rows, sources.associations),
      pullRequests: snapshots(pullRequests.rows, sources.pullRequests),
      stackComparisons: snapshots(comparisons.rows, sources.stackComparisons),
    },
    assessmentSync: sync.rows.find((row) => row.delivery_id === delivery.id)?.state ?? null,
  }))
}

export type RepositoryAssessmentDiagnostic = Awaited<ReturnType<typeof getRepositoryAssessmentDiagnostic>>
