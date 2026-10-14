import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireUser, mockResolveRepositoryFromParams, mockResolveRepositoryAdminAccess, mockGetExportData } =
  vi.hoisted(() => ({
    mockRequireUser: vi.fn(),
    mockResolveRepositoryFromParams: vi.fn(),
    mockResolveRepositoryAdminAccess: vi.fn(),
    mockGetExportData: vi.fn(),
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
  getRepositoryCodeDeliveryExportData: mockGetExportData,
}))

import { loader } from './repository.$owner.$repo.admin.code-deliveries.export'

const params = { owner: 'navikt', repo: 'glad-fjord' }

function makeRequest(search = ''): Request {
  return new Request(`http://localhost/repository/navikt/glad-fjord/admin/code-deliveries/export${search}`)
}

function makeExportData() {
  return {
    repositoryMetadata: {
      github_repo_id: '67890',
      github_owner: 'snapshot-owner',
      github_repo_name: 'snapshot-repo',
      default_branch: 'release',
      code_delivery_tracking_since: new Date('2026-09-15T00:00:00Z'),
      audit_start_year: 2025,
    },
    historyReadiness: {
      applications: [],
      repositoryDeploymentCount: 0,
      repositoryDeploymentsMissingShaCount: 0,
      repositoryDeploymentsWithoutKnownAppLinkCount: 0,
    },
    deployments: [],
    deliveries: [],
    ancestryEvidence: [],
    verificationRuns: [],
    repositoryConfigAuditLog: [],
    diagnosticTargets: [
      {
        unresolvedDeploymentId: 10,
        unresolvedDeployedAt: new Date('2026-10-14T10:00:00Z'),
        nearbyDeliveryCountPerSide: 2,
        includedDeliveryIds: [],
        includedDeploymentIds: [10],
      },
    ],
    implicitApprovalMode: 'off' as const,
    prSnapshots: [],
    commitSnapshots: [],
    workflowRunSnapshots: [],
  }
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
      implicit_approval_mode: 'off',
      code_delivery_tracking_since: new Date('2026-10-01T00:00:00Z'),
      audit_start_year: 2026,
    })
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true })
    mockGetExportData.mockResolvedValue(makeExportData())
  })

  it('returns a JSON attachment for the authorized repository', async () => {
    const response = await loader({
      params,
      request: makeRequest('?repositoryId=5'),
    } as never)

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="repository-5-unresolved-deployments-diagnostic.json"',
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(JSON.parse(await response.text())).toMatchObject({
      schemaVersion: 3,
      repository: {
        id: 5,
        githubRepositoryId: '67890',
        owner: 'snapshot-owner',
        name: 'snapshot-repo',
        defaultBranch: 'release',
        trackingSince: '2026-09-15T00:00:00.000Z',
        auditStartYear: 2025,
      },
      implicitApprovalMode: 'off',
      deployments: [],
      deliveries: [],
      verificationRuns: [],
      repositoryConfigAuditLog: [],
      diagnosticTargets: [{ unresolvedDeploymentId: 10 }],
      prSnapshots: [],
      commitSnapshots: [],
      workflowRunSnapshots: [],
      ancestryEvidence: { matchingCompareSnapshots: [] },
    })
    expect(mockGetExportData).toHaveBeenCalledWith(5, undefined)
    expect(mockResolveRepositoryFromParams).toHaveBeenCalledWith(
      'navikt',
      'glad-fjord',
      expect.any(URL),
      '/admin/code-deliveries/export',
    )
  })

  it('rejects unauthorized users without loading export data', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false })

    await expect(
      loader({
        params,
        request: makeRequest('?repositoryId=5&deploymentId=10'),
      } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockGetExportData).not.toHaveBeenCalled()
  })

  it('automatically exports all open unresolved deployments when deploymentId is omitted', async () => {
    mockGetExportData.mockResolvedValue({
      ...makeExportData(),
      diagnosticTargets: [
        {
          unresolvedDeploymentId: 10,
          unresolvedDeployedAt: new Date('2026-10-14T10:00:00Z'),
          nearbyDeliveryCountPerSide: 2,
          includedDeliveryIds: [],
          includedDeploymentIds: [10],
        },
        {
          unresolvedDeploymentId: 11,
          unresolvedDeployedAt: new Date('2026-10-14T11:00:00Z'),
          nearbyDeliveryCountPerSide: 2,
          includedDeliveryIds: [],
          includedDeploymentIds: [11],
        },
      ],
    })

    const response = await loader({
      params,
      request: makeRequest('?repositoryId=5'),
    } as never)

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="repository-5-unresolved-deployments-diagnostic.json"',
    )
    expect(JSON.parse(await response.text()).diagnosticTargets).toHaveLength(2)
    expect(mockGetExportData).toHaveBeenCalledWith(5, undefined)
  })

  it('rejects a requested deployment that is not open and unresolved in this repository', async () => {
    mockGetExportData.mockResolvedValue({ ...makeExportData(), diagnosticTargets: [] })

    await expect(
      loader({
        params,
        request: makeRequest('?repositoryId=5&deploymentId=10'),
      } as never),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('rejects deployment IDs outside the PostgreSQL integer range', async () => {
    await expect(
      loader({
        params,
        request: makeRequest('?repositoryId=5&deploymentId=2147483648'),
      } as never),
    ).rejects.toMatchObject({ status: 400 })

    expect(mockGetExportData).not.toHaveBeenCalled()
  })
})
