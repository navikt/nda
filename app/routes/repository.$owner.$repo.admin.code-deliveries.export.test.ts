import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireUser, mockResolveRepositoryFromParams, mockResolveRepositoryAdminAccess, mockListExportRows } =
  vi.hoisted(() => ({
    mockRequireUser: vi.fn(),
    mockResolveRepositoryFromParams: vi.fn(),
    mockResolveRepositoryAdminAccess: vi.fn(),
    mockListExportRows: vi.fn(),
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
  getRepositoryHistoryReadiness: vi.fn().mockResolvedValue({
    applications: [],
    repositoryDeploymentCount: 0,
    repositoryDeploymentsMissingShaCount: 0,
    repositoryDeploymentsWithoutKnownAppLinkCount: 0,
  }),
  listRepositoryCodeDeliveryAncestryEvidence: vi.fn().mockResolvedValue([]),
  listRepositoryCodeDeliveryExportRows: mockListExportRows,
}))

import { loader } from './repository.$owner.$repo.admin.code-deliveries.export'

const params = { owner: 'navikt', repo: 'glad-fjord' }

function makeRequest(search = ''): Request {
  return new Request(`http://localhost/repository/navikt/glad-fjord/admin/code-deliveries/export${search}`)
}

describe('repository code delivery export loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue({
      id: 5,
      github_repo_id: '12345',
      github_owner: 'navikt',
      github_repo_name: 'glad-fjord',
      default_branch: 'main',
      code_delivery_tracking_since: new Date('2026-10-01T00:00:00Z'),
      audit_start_year: 2026,
    })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true })
    mockListExportRows.mockResolvedValue([])
  })

  it('returns a JSON attachment for the authorized repository', async () => {
    const response = await loader({
      params,
      request: makeRequest('?repositoryId=5'),
    } as never)

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="repository-5-deployment-history.json"',
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(JSON.parse(await response.text())).toMatchObject({
      schemaVersion: 1,
      repository: { id: 5 },
      deployments: [],
      ancestryEvidence: { matchingCompareSnapshots: [] },
    })
    expect(mockListExportRows).toHaveBeenCalledWith(5)
    expect(mockResolveRepositoryFromParams).toHaveBeenCalledWith(
      'navikt',
      'glad-fjord',
      expect.any(URL),
      '/admin/code-deliveries/export',
    )
  })

  it('rejects unauthorized users without loading export rows', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false })

    await expect(
      loader({
        params,
        request: makeRequest('?repositoryId=5'),
      } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockListExportRows).not.toHaveBeenCalled()
  })
})
