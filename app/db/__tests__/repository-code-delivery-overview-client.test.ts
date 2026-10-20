import { beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery, withTransaction } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('../connection.server', () => ({
  pool: { query: poolQuery },
  withTransaction,
}))
vi.mock('../repository-code-delivery-assessment-sync.server', () => ({
  REPOSITORY_CODE_DELIVERY_ASSESSMENT_VERSION: 1,
}))
vi.mock('../repository-code-delivery-interval-assessment.server', () => ({
  getRepositoryCodeDeliveryIntervalAssessments: vi.fn(),
}))

import {
  getRepositoryCodeDeliveryOverview,
  getRepositoryHistoryReadiness,
  listOpenUnresolvedCodeDeployments,
} from '../repository-code-delivery-overview.server'

describe('repository delivery overview transaction client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockRejectedValue(new Error('Unexpected pool query'))
    withTransaction.mockRejectedValue(new Error('Unexpected nested transaction'))
  })

  it('reads overview counts on the supplied connection without accessing the pool', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    expect(await getRepositoryCodeDeliveryOverview(5, client)).toEqual({
      deliveryCount: 3,
      linkedDeploymentCount: 5,
      awaitingDeploymentCount: 2,
      unresolvedByReason: {},
    })
    expect(poolQuery).not.toHaveBeenCalled()
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('reads history readiness without opening a nested transaction', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ deployment_count: 5, deployments_missing_sha: 1, deployments_without_known_app_link: 2 }],
        }),
    }
    expect(await getRepositoryHistoryReadiness(5, client)).toEqual({
      applications: [],
      repositoryDeploymentCount: 5,
      repositoryDeploymentsMissingShaCount: 1,
      repositoryDeploymentsWithoutKnownAppLinkCount: 2,
    })
    expect(poolQuery).not.toHaveBeenCalled()
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('reads unresolved deployments on the supplied connection without accessing the pool', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect(await listOpenUnresolvedCodeDeployments(5, 100, client)).toEqual([])
    expect(client.query).toHaveBeenCalledWith(expect.any(String), [5, 100])
    expect(poolQuery).not.toHaveBeenCalled()
    expect(withTransaction).not.toHaveBeenCalled()
  })
})
