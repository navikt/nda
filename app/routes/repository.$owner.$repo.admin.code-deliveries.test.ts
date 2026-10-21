import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockCapabilities,
  mockGetOverview,
  mockGetHistoryReadiness,
  mockFollowUp,
  mockListUnresolved,
  mockClient,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockCapabilities: vi.fn(),
  mockGetOverview: vi.fn(),
  mockGetHistoryReadiness: vi.fn(),
  mockFollowUp: vi.fn(),
  mockListUnresolved: vi.fn(),
  mockClient: { query: vi.fn() },
}))

vi.mock('~/db/connection.server', () => ({
  withTransaction: (operation: (client: typeof mockClient) => Promise<unknown>) => operation(mockClient),
}))
vi.mock('~/lib/auth.server', () => ({ requireUser: mockRequireUser }))
vi.mock('~/lib/repository-resolution.server', () => ({
  resolveRepositoryFromParams: mockResolveRepositoryFromParams,
}))
vi.mock('~/lib/authorization.server', () => ({ resolveRepositoryApprovalCapabilities: mockCapabilities }))
vi.mock('~/db/repository-code-delivery-overview.server', () => ({
  getRepositoryCodeDeliveryOverview: mockGetOverview,
  getRepositoryHistoryReadiness: mockGetHistoryReadiness,
  listOpenUnresolvedCodeDeployments: mockListUnresolved,
}))
vi.mock('~/db/repository-code-delivery-follow-up.server', () => ({
  getRepositoryCodeDeliveryFollowUp: mockFollowUp,
}))

import {
  createDeliverySearchParams,
  getNextDeliverySort,
  loader,
} from './repository.$owner.$repo.admin.code-deliveries'

const params = { owner: 'navikt', repo: 'glad-fjord' }
const since = new Date('2026-10-01T08:00:00Z')
const repository = {
  id: 5,
  github_owner: 'navikt',
  github_repo_name: 'glad-fjord',
  code_delivery_tracking: true,
  code_delivery_tracking_since: since,
}
const counts = { approved: 21, not_approved: 22, incomplete: 1, no_changes: 1 }
const resultPage = { deliveries: [], counts, total: 22, page: 2, totalPages: 2 }

function makeRequest(search = '') {
  return new Request(`http://localhost/repository/navikt/glad-fjord/admin/code-deliveries${search}`)
}

describe('delivery navigation', () => {
  it('sorts ascending, then descending, then restores the default order', () => {
    expect(getNextDeliverySort(undefined, 'first_deployed_at')).toEqual({
      orderBy: 'first_deployed_at',
      direction: 'ascending',
    })
    expect(getNextDeliverySort({ orderBy: 'first_deployed_at', direction: 'ascending' }, 'first_deployed_at')).toEqual({
      orderBy: 'first_deployed_at',
      direction: 'descending',
    })
    expect(
      getNextDeliverySort({ orderBy: 'first_deployed_at', direction: 'descending' }, 'first_deployed_at'),
    ).toBeUndefined()
    expect(getNextDeliverySort(undefined, 'unknown')).toBeUndefined()
  })

  it('preserves the status filter while paging and sorting', () => {
    expect(
      createDeliverySearchParams(
        5,
        2,
        { orderBy: 'first_deployed_at', direction: 'descending' },
        'not_approved',
      ).toString(),
    ).toBe('repositoryId=5&page=2&sort=first_deployed_at&direction=descending&status=not_approved')
    expect(createDeliverySearchParams(5, 1, undefined, 'incomplete').toString()).toBe(
      'repositoryId=5&page=1&status=incomplete',
    )
    expect(createDeliverySearchParams(5, 1, undefined).toString()).toBe('repositoryId=5&page=1')
  })
})

describe('repository code deliveries loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockCapabilities.mockResolvedValue({ canAccessAdmin: true, canApprove: true })
    mockGetOverview.mockResolvedValue({
      deliveryCount: 45,
      linkedDeploymentCount: 0,
      awaitingDeploymentCount: 0,
      unresolvedByReason: {},
    })
    mockGetHistoryReadiness.mockResolvedValue({
      applications: [],
      repositoryDeploymentCount: 0,
      repositoryDeploymentsMissingShaCount: 0,
      repositoryDeploymentsWithoutKnownAppLinkCount: 0,
    })
    mockListUnresolved.mockResolvedValue([])
    mockFollowUp.mockResolvedValue(resultPage)
  })

  it('checks capabilities once before reading any delivery data', async () => {
    mockCapabilities.mockResolvedValue({ canAccessAdmin: false, canApprove: true })
    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })
    expect(mockFollowUp).not.toHaveBeenCalled()
    expect(mockGetOverview).not.toHaveBeenCalled()
    expect(mockListUnresolved).not.toHaveBeenCalled()
    expect(mockGetHistoryReadiness).not.toHaveBeenCalled()
  })

  it('returns filtered paging, totals and capabilities from the same assessment read', async () => {
    mockCapabilities.mockResolvedValue({ canAccessAdmin: true, canApprove: false })
    const result = await loader({
      params,
      request: makeRequest('?page=2&status=not_approved&sort=first_deployed_at&direction=ascending'),
    } as never)
    expect(mockCapabilities).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ navIdent: 'Z990010' }),
      5,
      mockClient,
    )
    expect(mockClient.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(mockGetOverview).toHaveBeenCalledExactlyOnceWith(5, mockClient)
    expect(mockListUnresolved).toHaveBeenCalledExactlyOnceWith(5, 100, mockClient)
    expect(mockGetHistoryReadiness).toHaveBeenCalledExactlyOnceWith(5, mockClient)
    expect(mockFollowUp).toHaveBeenCalledWith(
      5,
      {
        page: 2,
        pageSize: 20,
        status: 'not_approved',
        sort: { orderBy: 'first_deployed_at', direction: 'ascending' },
      },
      mockClient,
    )
    expect(result).toMatchObject({
      repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
      tracking: { enabled: true, since },
      followUpCounts: counts,
      filteredTotal: 22,
      page: 2,
      totalPages: 2,
      canApprove: false,
      status: 'not_approved',
    })
  })

  it.each(['', '?page=abc', '?page=0', '?page=-3', '?page=9007199254740992'])(
    'normalises invalid page input %s',
    async (search) => {
      await loader({ params, request: makeRequest(search) } as never)
      expect(mockFollowUp).toHaveBeenCalledWith(
        5,
        { page: 1, pageSize: 20, status: 'all', sort: undefined },
        mockClient,
      )
    },
  )

  it('passes a page beyond the end to the filtered pagination service', async () => {
    await loader({ params, request: makeRequest('?page=99&status=incomplete') } as never)
    expect(mockFollowUp).toHaveBeenCalledWith(
      5,
      { page: 99, pageSize: 20, status: 'incomplete', sort: undefined },
      mockClient,
    )
  })

  it('ignores invalid status and sorting parameters', async () => {
    await loader({
      params,
      request: makeRequest('?status=other&sort=id;DROP%20TABLE%20deployments&direction=sideways'),
    } as never)
    expect(mockFollowUp).toHaveBeenCalledWith(5, { page: 1, pageSize: 20, status: 'all', sort: undefined }, mockClient)
  })
})
