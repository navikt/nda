import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockResolveRepositoryAdminAccess,
  mockGetExportData,
  mockGetDeliveryExportData,
  mockFetchDiagnosticEvidence,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetExportData: vi.fn(),
  mockGetDeliveryExportData: vi.fn(),
  mockFetchDiagnosticEvidence: vi.fn(),
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
  getRepositoryCodeDeliveryDiagnosticForDelivery: mockGetDeliveryExportData,
}))

vi.mock('~/lib/github/repository-diagnostic-evidence.server', () => ({
  fetchRepositoryDiagnosticGitHubEvidence: mockFetchDiagnosticEvidence,
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
    repositoryAliases: [{ owner: 'old-navikt', repo: 'old-snapshot-repo' }],
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
    deliveryTarget: null,
    implicitApprovalMode: 'off' as const,
    repositoryAssessments: [],
    prSnapshots: [],
    commitSnapshots: [],
    workflowRunSnapshots: [],
    liveGitHubEvidence: {
      fetchedAt: '2026-10-14T10:59:00.000Z',
      status: 'not_needed',
      requestLimit: 100,
      requestsAttempted: 0,
      pullRequests: [],
      workflowRuns: [],
    },
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
    mockGetDeliveryExportData.mockResolvedValue(makeExportData())
    mockFetchDiagnosticEvidence.mockResolvedValue({
      fetchedAt: '2026-10-14T10:59:00.000Z',
      status: 'not_needed',
      requestLimit: 100,
      requestsAttempted: 0,
      pullRequests: [],
      workflowRuns: [],
    })
  })

  it('includes repository evidence independently of application snapshots and live evidence', async () => {
    const repositoryAssessments = [
      {
        deliveryId: 12,
        intervalAssessment: { commits: [{ reason: 'approval_before_last_commit' }] },
        approvalAssessment: { status: 'incomplete', commits: [{ reason: 'unknown_commit_author' }] },
        evaluationInput: { implicitApprovalMode: 'off' },
        snapshots: { pullRequests: [{ id: 123, data_type: 'reviews', data: [] }] },
        assessmentSync: { failed_permanently: true },
      },
    ]
    mockGetDeliveryExportData.mockResolvedValue({
      ...makeExportData(),
      deliveryTarget: { deliveryId: 12, includedDeploymentIds: [] },
      repositoryAssessments,
    })
    const response = await loader({ params, request: makeRequest('?deliveryId=12') } as never)
    const body = JSON.parse(await response.text())
    expect(body.repositoryAssessments).toEqual(repositoryAssessments)
    expect(body.prSnapshots).toEqual([])
    expect(body.verificationRuns).toEqual([])
    expect(body.liveGitHubEvidence.status).toBe('not_needed')
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
      schemaVersion: 6,
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
      liveGitHubEvidence: { status: 'not_needed' },
      ancestryEvidence: { matchingCompareSnapshots: [] },
    })
    expect(mockGetExportData).toHaveBeenCalledWith(5, undefined)
    expect(mockFetchDiagnosticEvidence).toHaveBeenCalledWith({
      owner: 'snapshot-owner',
      repo: 'snapshot-repo',
      repositoryAliases: [{ owner: 'old-navikt', repo: 'old-snapshot-repo' }],
      deployments: [],
      verificationRuns: [],
      prSnapshots: [],
      workflowRunSnapshots: [],
    })
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
    expect(mockFetchDiagnosticEvidence).not.toHaveBeenCalled()
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

  it('exports a selected delivery and linked deployment evidence', async () => {
    mockGetDeliveryExportData.mockResolvedValue({
      ...makeExportData(),
      diagnosticTargets: [],
      deliveryTarget: { deliveryId: 12, includedDeploymentIds: [101, 102, 103, 104] },
      deliveries: [
        {
          id: 12,
          base_sha: 'a'.repeat(40),
          head_sha: 'b'.repeat(40),
          registered_at: new Date('2026-10-14T09:00:00Z'),
          first_deployed_at: new Date('2026-10-14T10:00:00Z'),
          deployment_count: 4,
          contexts: [],
        },
      ],
      deployments: [{ deployment_id: 101 }, { deployment_id: 102 }, { deployment_id: 103 }, { deployment_id: 104 }],
    })

    const response = await loader({
      params,
      request: makeRequest('?repositoryId=5&deliveryId=12'),
    } as never)
    const body = JSON.parse(await response.text())

    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="repository-5-delivery-12-diagnostic.json"',
    )
    expect(body.deliveryTarget).toEqual({ deliveryId: 12, includedDeploymentIds: [101, 102, 103, 104] })
    expect(body.deliveries).toHaveLength(1)
    expect(body.deployments).toHaveLength(4)
    expect(body.ancestryEvidence.linkageNote).toBe(
      'No ancestry compare snapshots are included in this delivery-scoped export; there is no unresolved deployment target.',
    )
    expect(mockGetDeliveryExportData).toHaveBeenCalledWith(5, 12)
    expect(mockGetExportData).not.toHaveBeenCalled()
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

  it.each(['?repositoryId=5&deliveryId=0', '?repositoryId=5&deliveryId=2147483648'])(
    'rejects an invalid delivery ID (%s)',
    async (search) => {
      await expect(loader({ params, request: makeRequest(search) } as never)).rejects.toMatchObject({ status: 400 })

      expect(mockGetDeliveryExportData).not.toHaveBeenCalled()
    },
  )

  it('rejects simultaneous deployment and delivery targets', async () => {
    await expect(
      loader({ params, request: makeRequest('?repositoryId=5&deploymentId=10&deliveryId=12') } as never),
    ).rejects.toMatchObject({ status: 400 })

    expect(mockGetExportData).not.toHaveBeenCalled()
    expect(mockGetDeliveryExportData).not.toHaveBeenCalled()
  })

  it('rejects a delivery that is not registered in this repository', async () => {
    mockGetDeliveryExportData.mockResolvedValue({ ...makeExportData(), deliveryTarget: null })

    await expect(
      loader({ params, request: makeRequest('?repositoryId=5&deliveryId=12') } as never),
    ).rejects.toMatchObject({ status: 404 })
  })
})
