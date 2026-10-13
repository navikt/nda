import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireAdmin,
  mockGetWorkflowRunBackfillCoverageTeams,
  mockGetWorkflowRunRepositoryBackfillCoverage,
  mockGetWorkflowRunBackfillPreviewRepository,
  mockGetWorkflowRunRepositoryBackfillPreview,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetWorkflowRunBackfillCoverageTeams: vi.fn(),
  mockGetWorkflowRunRepositoryBackfillCoverage: vi.fn(),
  mockGetWorkflowRunBackfillPreviewRepository: vi.fn(),
  mockGetWorkflowRunRepositoryBackfillPreview: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('~/db/workflow-run-repository-backfill-coverage.server', () => ({
  getWorkflowRunBackfillCoverageTeams: mockGetWorkflowRunBackfillCoverageTeams,
  getWorkflowRunRepositoryBackfillCoverage: mockGetWorkflowRunRepositoryBackfillCoverage,
  getWorkflowRunBackfillPreviewRepository: mockGetWorkflowRunBackfillPreviewRepository,
  getWorkflowRunRepositoryBackfillPreview: mockGetWorkflowRunRepositoryBackfillPreview,
}))

import { loader } from './repository-id-backfill-coverage'

describe('repository ID backfill coverage loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ navIdent: 'Z990001' })
    mockGetWorkflowRunBackfillCoverageTeams.mockResolvedValue([])
    mockGetWorkflowRunRepositoryBackfillCoverage.mockResolvedValue([])
    mockGetWorkflowRunBackfillPreviewRepository.mockResolvedValue(null)
    mockGetWorkflowRunRepositoryBackfillPreview.mockResolvedValue([])
  })

  it('loads team options without running the coverage report until a team is selected', async () => {
    mockGetWorkflowRunBackfillCoverageTeams.mockResolvedValue(['team-a', 'team-b'])

    const result = await loader({
      request: new Request('http://localhost/admin/repository-id-backfill-coverage'),
    } as never)

    expect(mockRequireAdmin).toHaveBeenCalledOnce()
    expect(mockGetWorkflowRunRepositoryBackfillCoverage).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      teams: ['team-a', 'team-b'],
      selectedTeam: null,
      invalidTeam: false,
      repositories: [],
      totals: { legacy: 0, eligible: 0 },
      previewRepository: null,
      previewDeployments: [],
      invalidRepository: false,
    })
  })

  it('runs the coverage report only for a recognized selected team', async () => {
    mockGetWorkflowRunBackfillCoverageTeams.mockResolvedValue(['team-a', 'team-b'])
    mockGetWorkflowRunRepositoryBackfillCoverage.mockResolvedValue([
      {
        repositoryId: 216,
        githubOwner: 'navikt',
        githubRepoName: 'pensjon-alde',
        totalLegacyDeployments: 8,
        eligible: 3,
        noTriggerUrl: 1,
        invalidTriggerUrl: 0,
        triggerUrlMismatch: 0,
        missingSnapshot: 2,
        repositoryMismatch: 1,
        shaMismatch: 0,
        unsupportedEvent: 1,
        headRepositoryMismatch: 0,
      },
    ])

    const result = await loader({
      request: new Request('http://localhost/admin/repository-id-backfill-coverage?team=team-a'),
    } as never)

    expect(mockRequireAdmin).toHaveBeenCalledOnce()
    expect(mockGetWorkflowRunRepositoryBackfillCoverage).toHaveBeenCalledWith('team-a')
    expect(result).toMatchObject({
      teams: ['team-a', 'team-b'],
      selectedTeam: 'team-a',
      invalidTeam: false,
      totals: { legacy: 8, eligible: 3 },
      repositories: [{ repositoryId: 216, eligible: 3 }],
    })
  })

  it('does not run the report for an unknown team', async () => {
    mockGetWorkflowRunBackfillCoverageTeams.mockResolvedValue(['team-a'])

    const result = await loader({
      request: new Request('http://localhost/admin/repository-id-backfill-coverage?team=not-a-team'),
    } as never)

    expect(mockGetWorkflowRunRepositoryBackfillCoverage).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      selectedTeam: null,
      invalidTeam: true,
      repositories: [],
    })
  })

  it('loads only the repository-wide preview for a valid registered repository', async () => {
    mockGetWorkflowRunBackfillPreviewRepository.mockResolvedValue({
      repositoryId: 216,
      githubOwner: 'navikt',
      githubRepoName: 'pensjon-alde',
    })
    mockGetWorkflowRunRepositoryBackfillPreview.mockResolvedValue([
      {
        deploymentId: 10,
        teamSlug: 'pensjondeployer',
        appName: 'alde',
        environmentName: 'prod-gcp',
        createdAt: new Date('2026-10-13T12:00:00.000Z'),
        commitSha: 'a'.repeat(40),
        workflowRunId: '123',
        classification: 'eligible',
      },
      {
        deploymentId: 11,
        teamSlug: 'pensjon-saksbehandling',
        appName: 'alde',
        environmentName: 'prod-gcp',
        createdAt: new Date('2026-10-13T12:01:00.000Z'),
        commitSha: 'b'.repeat(40),
        workflowRunId: null,
        classification: 'no_trigger_url',
      },
    ])

    const result = await loader({
      request: new Request('http://localhost/admin/repository-id-backfill-coverage?repositoryId=216&team=team-a'),
    } as never)

    expect(mockGetWorkflowRunBackfillCoverageTeams).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunRepositoryBackfillCoverage).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunBackfillPreviewRepository).toHaveBeenCalledWith(216)
    expect(mockGetWorkflowRunRepositoryBackfillPreview).toHaveBeenCalledWith(216)
    expect(result).toMatchObject({
      previewRepository: { repositoryId: 216, githubOwner: 'navikt', githubRepoName: 'pensjon-alde' },
      previewDeployments: [{ teamSlug: 'pensjondeployer' }, { teamSlug: 'pensjon-saksbehandling' }],
      totals: { legacy: 2, eligible: 1 },
      invalidRepository: false,
      returnToTeam: 'team-a',
    })
  })

  it('does not run a preview for an invalid repository ID', async () => {
    const result = await loader({
      request: new Request('http://localhost/admin/repository-id-backfill-coverage?repositoryId=216x'),
    } as never)

    expect(mockGetWorkflowRunBackfillPreviewRepository).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunRepositoryBackfillPreview).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunBackfillCoverageTeams).not.toHaveBeenCalled()
    expect(result).toMatchObject({ invalidRepository: true, previewDeployments: [] })
  })

  it('does not run a preview for an unknown registered repository ID', async () => {
    const result = await loader({
      request: new Request('http://localhost/admin/repository-id-backfill-coverage?repositoryId=216'),
    } as never)

    expect(mockGetWorkflowRunBackfillPreviewRepository).toHaveBeenCalledWith(216)
    expect(mockGetWorkflowRunRepositoryBackfillPreview).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunBackfillCoverageTeams).not.toHaveBeenCalled()
    expect(result).toMatchObject({ invalidRepository: true, previewDeployments: [] })
  })

  it('does not query coverage when the requester is not a global admin', async () => {
    mockRequireAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }))

    await expect(
      loader({
        request: new Request('http://localhost/admin/repository-id-backfill-coverage'),
      } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockGetWorkflowRunBackfillCoverageTeams).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunRepositoryBackfillCoverage).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunBackfillPreviewRepository).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunRepositoryBackfillPreview).not.toHaveBeenCalled()
  })
})
