import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAdmin, mockGetWorkflowRunBackfillCoverageTeams, mockGetWorkflowRunRepositoryBackfillCoverage } =
  vi.hoisted(() => ({
    mockRequireAdmin: vi.fn(),
    mockGetWorkflowRunBackfillCoverageTeams: vi.fn(),
    mockGetWorkflowRunRepositoryBackfillCoverage: vi.fn(),
  }))

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('~/db/workflow-run-repository-backfill-coverage.server', () => ({
  getWorkflowRunBackfillCoverageTeams: mockGetWorkflowRunBackfillCoverageTeams,
  getWorkflowRunRepositoryBackfillCoverage: mockGetWorkflowRunRepositoryBackfillCoverage,
}))

import { loader } from './repository-id-backfill-coverage'

describe('repository ID backfill coverage loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ navIdent: 'Z990001' })
    mockGetWorkflowRunBackfillCoverageTeams.mockResolvedValue([])
    mockGetWorkflowRunRepositoryBackfillCoverage.mockResolvedValue([])
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

  it('does not query coverage when the requester is not a global admin', async () => {
    mockRequireAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }))

    await expect(
      loader({
        request: new Request('http://localhost/admin/repository-id-backfill-coverage'),
      } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockGetWorkflowRunBackfillCoverageTeams).not.toHaveBeenCalled()
    expect(mockGetWorkflowRunRepositoryBackfillCoverage).not.toHaveBeenCalled()
  })
})
