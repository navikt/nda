import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockResolveRepositoryAdminAccess,
  mockGetOverview,
  mockListDeliveries,
  mockListUnresolved,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetOverview: vi.fn(),
  mockListDeliveries: vi.fn(),
  mockListUnresolved: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: mockRequireUser,
}))

vi.mock('~/lib/repository-resolution.server', () => ({
  resolveRepositoryFromParams: mockResolveRepositoryFromParams,
}))

vi.mock('~/lib/authorization.server', () => ({
  resolveRepositoryAdminAccess: mockResolveRepositoryAdminAccess,
}))

vi.mock('~/db/repository-code-delivery-overview.server', () => ({
  getRepositoryCodeDeliveryOverview: mockGetOverview,
  listRepositoryCodeDeliveries: mockListDeliveries,
  listOpenUnresolvedCodeDeployments: mockListUnresolved,
}))

import {
  createDeliverySearchParams,
  getNextDeliverySort,
  loader,
} from './repository.$owner.$repo.admin.code-deliveries'

const params = { owner: 'navikt', repo: 'glad-fjord' }

function makeRequest(search = ''): Request {
  return new Request(`http://localhost/repository/navikt/glad-fjord/admin/code-deliveries${search}`)
}

const since = new Date('2026-10-01T08:00:00Z')
const repository = {
  id: 5,
  github_owner: 'navikt',
  github_repo_name: 'glad-fjord',
  code_delivery_tracking: true,
  code_delivery_tracking_since: since,
}

describe('getNextDeliverySort', () => {
  it('sorts ascending, then descending, then restores the default order', () => {
    expect(getNextDeliverySort(undefined, 'first_deployed_at')).toEqual({
      orderBy: 'first_deployed_at',
      direction: 'ascending',
    })
    expect(getNextDeliverySort({ orderBy: 'first_deployed_at', direction: 'ascending' }, 'first_deployed_at')).toEqual({
      orderBy: 'first_deployed_at',
      direction: 'descending',
    })
    expect(getNextDeliverySort({ orderBy: 'first_deployed_at', direction: 'descending' }, 'first_deployed_at')).toBe(
      undefined,
    )
  })

  it('starts a new column sort in ascending order and ignores unknown keys', () => {
    expect(getNextDeliverySort({ orderBy: 'first_deployed_at', direction: 'descending' }, 'deployment_count')).toEqual({
      orderBy: 'deployment_count',
      direction: 'ascending',
    })
    expect(getNextDeliverySort(undefined, 'unknown')).toBeUndefined()
  })

  it('removes sorting from the URL when sort is explicitly cleared', () => {
    const searchParams = createDeliverySearchParams(5, 1, undefined)

    expect(searchParams.toString()).toBe('repositoryId=5&page=1')
  })

  it('preserves sorting parameters when navigating between pages', () => {
    const searchParams = createDeliverySearchParams(5, 2, {
      orderBy: 'first_deployed_at',
      direction: 'descending',
    })

    expect(searchParams.toString()).toBe('repositoryId=5&page=2&sort=first_deployed_at&direction=descending')
  })
})

function overviewWith(deliveryCount: number) {
  return { deliveryCount, linkedDeploymentCount: 0, awaitingDeploymentCount: 0, unresolvedByReason: {} }
}

describe('repository code deliveries loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [{ id: 1 }] })
    mockGetOverview.mockResolvedValue(overviewWith(45))
    mockListDeliveries.mockResolvedValue([])
    mockListUnresolved.mockResolvedValue([])
  })

  it('throws 403 and skips all queries when not authorized', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })

    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetOverview).not.toHaveBeenCalled()
    expect(mockListDeliveries).not.toHaveBeenCalled()
    expect(mockListUnresolved).not.toHaveBeenCalled()
  })

  it('returns repository, tracking state and the requested page', async () => {
    const result = await loader({ params, request: makeRequest('?page=2') } as never)

    expect(mockListDeliveries).toHaveBeenCalledWith(5, { limit: 20, offset: 20, sort: undefined })
    expect(mockListUnresolved).toHaveBeenCalledWith(5, 100)
    expect(result).toMatchObject({
      repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
      tracking: { enabled: true, since },
      page: 2,
      totalPages: 3,
    })
  })

  it.each([
    ['missing', '', 1],
    ['not a number', '?page=abc', 1],
    ['zero', '?page=0', 1],
    ['negative', '?page=-3', 1],
    ['beyond the last page', '?page=99', 3],
  ])('normalises the page parameter (%s)', async (_label, search, expectedPage) => {
    const result = await loader({ params, request: makeRequest(search) } as never)

    expect(result.page).toBe(expectedPage)
    expect(mockListDeliveries).toHaveBeenCalledWith(5, {
      limit: 20,
      offset: (expectedPage - 1) * 20,
      sort: undefined,
    })
  })

  it('reports a single page when there are no deliveries', async () => {
    mockGetOverview.mockResolvedValue(overviewWith(0))

    const result = await loader({ params, request: makeRequest('?page=4') } as never)

    expect(result).toMatchObject({ page: 1, totalPages: 1 })
    expect(mockListDeliveries).toHaveBeenCalledWith(5, { limit: 20, offset: 0, sort: undefined })
  })

  it('validates and forwards delivery sorting from the URL', async () => {
    const result = await loader({
      params,
      request: makeRequest('?page=2&sort=first_deployed_at&direction=ascending'),
    } as never)

    expect(mockListDeliveries).toHaveBeenCalledWith(5, {
      limit: 20,
      offset: 20,
      sort: { orderBy: 'first_deployed_at', direction: 'ascending' },
    })
    expect(result).toMatchObject({
      page: 2,
      sort: { orderBy: 'first_deployed_at', direction: 'ascending' },
    })
  })

  it('ignores invalid delivery sorting parameters', async () => {
    await loader({
      params,
      request: makeRequest('?sort=id;DROP%20TABLE%20deployments&direction=sideways'),
    } as never)

    expect(mockListDeliveries).toHaveBeenCalledWith(5, { limit: 20, offset: 0, sort: undefined })
  })
})
