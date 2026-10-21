import type { PoolClient } from 'pg'
import {
  type DeploymentRepositoryStatus,
  type DeploymentRepositorySummary,
  parseDeploymentRepositoryStatus,
} from '~/lib/deployment-repository-status'
import { isFullCommitSha } from '~/lib/git-constants'
import { withTransaction } from './connection.server'
import { type DeploymentFilters, type DeploymentWithApp, getDeploymentsPaginated } from './deployments.server'
import { getStoredRepositoryDeliveryAssessments } from './repository-delivery-assessments.server'

async function getDeploymentRepositorySummaries(client: Pick<PoolClient, 'query'>, deploymentIds: number[]) {
  const { rows } = await client.query<{
    id: number
    repository_id: number | null
    repository_code_delivery_id: number | null
    commit_sha: string | null
    delivery_repository_id: number | null
    base_sha: string | null
    head_sha: string | null
  }>(
    `SELECT d.id, d.repository_id, d.repository_code_delivery_id, d.commit_sha,
            cd.repository_id AS delivery_repository_id, cd.base_sha, cd.head_sha
     FROM deployments d
     LEFT JOIN repository_code_deliveries cd ON cd.id = d.repository_code_delivery_id
     WHERE d.id = ANY($1::int[])`,
    [deploymentIds],
  )
  const summaries: Record<number, DeploymentRepositorySummary> = {}
  const repositories = new Map<number, Map<number, { id: number; base_sha: string; head_sha: string }>>()
  for (const row of rows) {
    if (row.repository_code_delivery_id === null) {
      summaries[row.id] = { status: 'missing_link', range: null }
      continue
    }
    if (
      row.repository_id === null ||
      row.delivery_repository_id !== row.repository_id ||
      !row.commit_sha ||
      !isFullCommitSha(row.commit_sha) ||
      !row.head_sha ||
      row.commit_sha.toLowerCase() !== row.head_sha.toLowerCase() ||
      !row.base_sha
    ) {
      throw new Error(`Deployment ${row.id} has an inconsistent repository code delivery link`)
    }
    const deliveries = repositories.get(row.repository_id) ?? new Map()
    deliveries.set(row.repository_code_delivery_id, {
      id: row.repository_code_delivery_id,
      base_sha: row.base_sha,
      head_sha: row.head_sha,
    })
    repositories.set(row.repository_id, deliveries)
  }
  for (const [repositoryId, deliveries] of repositories) {
    const { assessments } = await getStoredRepositoryDeliveryAssessments(client, repositoryId, [...deliveries.values()])
    for (const row of rows) {
      if (row.repository_id !== repositoryId || row.repository_code_delivery_id === null) continue
      const assessment = assessments.get(row.repository_code_delivery_id)
      const delivery = deliveries.get(row.repository_code_delivery_id)
      if (!assessment || !delivery) throw new Error(`Missing approval assessment for deployment ${row.id}`)
      summaries[row.id] = {
        status: assessment.assessment.status,
        range: { baseSha: delivery.base_sha, headSha: delivery.head_sha },
      }
    }
  }
  for (const id of deploymentIds) {
    if (!summaries[id]) throw new Error(`Missing repository summary for deployment ${id}`)
  }
  return summaries
}

export async function getRepositoryDeploymentsPaginated(filters: DeploymentFilters, repositoryStatus?: string) {
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const page = filters.page ?? 1
    const perPage = filters.per_page ?? 20
    const status = parseDeploymentRepositoryStatus(repositoryStatus)
    const counts: Record<DeploymentRepositoryStatus, number> = {
      approved: 0,
      not_approved: 0,
      incomplete: 0,
      missing_link: 0,
      no_changes: 0,
    }
    const deployments: DeploymentWithApp[] = []
    const repositorySummaries: Record<number, DeploymentRepositorySummary> = {}
    let matchingCount = 0
    let batchPage = 1
    let totalPages: number
    do {
      const batch = await getDeploymentsPaginated(
        {
          ...filters,
          four_eyes_status: undefined,
          group_by_sha: false,
          page: batchPage,
          per_page: 100,
        },
        client,
      )
      totalPages = batch.total_pages
      const summaries =
        batch.deployments.length > 0
          ? await getDeploymentRepositorySummaries(
              client,
              batch.deployments.map((deployment) => deployment.id),
            )
          : {}
      for (const deployment of batch.deployments) {
        const summary = summaries[deployment.id]
        counts[summary.status]++
        if (status && summary.status !== status) continue
        if (matchingCount >= (page - 1) * perPage && deployments.length < perPage) {
          deployments.push(deployment)
          repositorySummaries[deployment.id] = summary
        }
        matchingCount++
      }
      batchPage++
    } while (batchPage <= totalPages)
    return {
      deployments,
      repositorySummaries,
      repositoryCounts: counts,
      total: matchingCount,
      page,
      per_page: perPage,
      total_pages: Math.ceil(matchingCount / perPage),
    }
  })
}
