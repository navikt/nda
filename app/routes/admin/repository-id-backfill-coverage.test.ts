import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAdmin, mockGetWorkflowRunRepositoryBackfillCoverage } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetWorkflowRunRepositoryBackfillCoverage: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('~/db/workflow-run-repository-backfill-coverage.server', () => ({
  getWorkflowRunRepositoryBackfillCoverage: mockGetWorkflowRunRepositoryBackfillCoverage,
}))

import { loader } from './repository-id-backfill-coverage'

describe('repository ID backfill coverage loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ navIdent: 'Z990001' })
  })

  it('requires a global admin and returns aggregated coverage', async () => {
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
      request: new Request('http://localhost/admin/repository-id-backfill-coverage'),
    } as never)

    expect(mockRequireAdmin).toHaveBeenCalledOnce()
    expect(mockGetWorkflowRunRepositoryBackfillCoverage).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      totals: { legacy: 8, eligible: 3 },
      repositories: [{ repositoryId: 216, eligible: 3 }],
    })
  })

  it('does not query coverage when the requester is not a global admin', async () => {
    mockRequireAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }))

    await expect(
      loader({
        request: new Request('http://localhost/admin/repository-id-backfill-coverage'),
      } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockGetWorkflowRunRepositoryBackfillCoverage).not.toHaveBeenCalled()
  })
})
