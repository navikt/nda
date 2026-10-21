import { beforeEach, describe, expect, it, vi } from 'vitest'

const { query, getDeployments, getPage, getIntervals, getHistory, getLookups } = vi.hoisted(() => ({
  query: vi.fn(),
  getDeployments: vi.fn(),
  getPage: vi.fn(),
  getIntervals: vi.fn(),
  getHistory: vi.fn(),
  getLookups: vi.fn(),
}))
vi.mock('../connection.server', () => ({
  withTransaction: (read: (client: { query: typeof query }) => Promise<unknown>) => read({ query }),
}))
vi.mock('../deployments.server', () => ({ getDeploymentsBatch: getDeployments, getDeploymentsPaginated: getPage }))
vi.mock('../repository-code-delivery-interval-assessment.server', () => ({
  getRepositoryCodeDeliveryIntervalAssessments: getIntervals,
}))
vi.mock('../repository-manual-approval-commits.server', () => ({ getRepositoryManualApprovalCommits: getHistory }))
vi.mock('../user-github-lookups.server', () => ({ getGithubUserLookups: getLookups }))

import { getRepositoryDeploymentsPaginated } from '../deployment-repository-list.server'

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)

function linked(id: number, deliveryId = 7) {
  return {
    id,
    repository_id: 5,
    repository_code_delivery_id: deliveryId,
    commit_sha: headSha,
    delivery_repository_id: 5,
    base_sha: baseSha,
    head_sha: headSha,
  }
}

describe('repository deployment list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockImplementation(async (sql: string, params?: [number[]]) => ({
      rows: sql.includes('FROM deployments') ? params?.[0].map((id) => linked(id)) : [],
    }))
    getHistory.mockResolvedValue([])
    getLookups.mockResolvedValue(new Map())
    getIntervals.mockImplementation(async (_repositoryId, deliveries) =>
      deliveries.map((delivery: { id: number }) => ({
        deliveryId: delivery.id,
        assessment: {
          comparisonComplete: true,
          totalCommits: 1,
          commits: [{ sha: headSha, status: 'covered', authorLogin: 'glad-fjord' }],
        },
      })),
    )
    getDeployments.mockResolvedValue([{ id: 42 }, { id: 43 }])
    getPage.mockResolvedValue({
      deployments: [{ id: 42 }, { id: 43 }],
      total: 200,
      page: 2,
      per_page: 2,
      total_pages: 100,
    })
  })

  it('deduplicates shared deliveries and uses one client for evidence, manual history and identities', async () => {
    const result = await getRepositoryDeploymentsPaginated({ monitored_app_ids: [3], four_eyes_status: 'error' })
    expect(result).toMatchObject({
      total: 200,
      repositorySummaries: { 42: { status: 'approved', range: { baseSha, headSha } }, 43: { status: 'approved' } },
    })
    expect(getIntervals).toHaveBeenCalledExactlyOnceWith(5, [{ id: 7, base_sha: baseSha, head_sha: headSha }], {
      query,
    })
    expect(getHistory).toHaveBeenCalledWith({ query }, 5, [7])
    expect(getLookups).toHaveBeenCalledWith(['glad-fjord'], { query })
    expect(getPage).toHaveBeenCalledWith(
      expect.objectContaining({
        monitored_app_ids: [3],
        four_eyes_status: undefined,
        group_by_sha: false,
      }),
      { query },
    )
    expect(getDeployments).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE d.id = ANY'), [[42, 43]])
    expect(query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  })

  it('does not fetch evidence for an empty unfiltered page', async () => {
    getPage.mockResolvedValue({ deployments: [], total: 200, page: 101, per_page: 2, total_pages: 100 })
    const result = await getRepositoryDeploymentsPaginated({ page: 101, per_page: 2 })
    expect(result).toMatchObject({ total: 200, deployments: [], repositorySummaries: {} })
    expect(getIntervals).not.toHaveBeenCalled()
    expect(getDeployments).not.toHaveBeenCalled()
  })

  it('filters and counts across batches before selecting the requested page', async () => {
    getDeployments.mockImplementation(async (_filters, _client, afterId) =>
      afterId === undefined
        ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
        : [{ id: 101 }, { id: 102 }],
    )
    query.mockImplementation(async (sql: string, params?: [number[]]) => ({
      rows: sql.includes('FROM deployments')
        ? params?.[0].map((id) =>
            id > 100
              ? { ...linked(id), repository_code_delivery_id: null, head_sha: null, base_sha: null }
              : linked(id),
          )
        : [],
    }))
    const result = await getRepositoryDeploymentsPaginated({ page: 2, per_page: 1 }, 'missing_link')
    expect(result).toMatchObject({
      deployments: [{ id: 102 }],
      total: 2,
      page: 2,
      total_pages: 2,
      repositorySummaries: { 102: { status: 'missing_link', range: null } },
    })
    expect(result.repositorySummaries).not.toHaveProperty('101')
    expect(getDeployments).toHaveBeenNthCalledWith(2, expect.any(Object), { query }, 100)
  })

  it('does not use a matching SHA or an old approved status without the explicit delivery link', async () => {
    getDeployments.mockResolvedValue([{ id: 42, four_eyes_status: 'approved' }])
    query.mockResolvedValue({ rows: [{ ...linked(42), repository_code_delivery_id: null }] })
    const result = await getRepositoryDeploymentsPaginated({}, 'approved')
    expect(result).toMatchObject({ deployments: [], total: 0 })
    expect(getIntervals).not.toHaveBeenCalled()
  })

  it('keeps manual approvals scoped to their delivery even when deliveries share a commit', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM deployments') ? [linked(42), linked(43, 8)] : [],
    }))
    getIntervals.mockImplementation(async (_repo, deliveries) =>
      deliveries.map((delivery: { id: number }) => ({
        deliveryId: delivery.id,
        assessment: {
          comparisonComplete: true,
          totalCommits: 1,
          commits: [{ sha: headSha, status: 'not_covered', authorLogin: 'glad-fjord' }],
        },
      })),
    )
    getLookups.mockResolvedValue(new Map([['glad-fjord', { account_deleted_at: null, active_nav_ident: 'Z990001' }]]))
    getHistory.mockResolvedValue([
      {
        delivery_id: 7,
        sha: headSha,
        status: 'eligible',
        author_login: 'glad-fjord',
        author_nav_ident: 'Z990001',
        reviewer_nav_ident: 'Z990002',
      },
    ])
    const result = await getRepositoryDeploymentsPaginated({})
    expect(result.repositorySummaries).toMatchObject({ 42: { status: 'approved' }, 43: { status: 'not_approved' } })
  })

  it('keeps incomplete evidence separate from missing links and treats an anchor as no code changes', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM deployments') ? [linked(42), { ...linked(43, 8), base_sha: headSha }] : [],
    }))
    getIntervals.mockImplementation(async (_repo, deliveries) =>
      deliveries.map((delivery: { id: number }) => ({
        deliveryId: delivery.id,
        assessment: { comparisonComplete: false, totalCommits: null, commits: [] },
      })),
    )
    const result = await getRepositoryDeploymentsPaginated({})
    expect(result.repositorySummaries).toMatchObject({ 42: { status: 'incomplete' }, 43: { status: 'no_changes' } })
  })

  it.each([{ delivery_repository_id: 9 }, { commit_sha: 'c'.repeat(40) }, { commit_sha: null }])(
    'fails explicitly for inconsistent stored links: %s',
    async (patch) => {
      query.mockResolvedValue({ rows: [{ ...linked(42), ...patch }] })
      await expect(getRepositoryDeploymentsPaginated({})).rejects.toThrow('inconsistent')
      expect(getIntervals).not.toHaveBeenCalled()
    },
  )
})
