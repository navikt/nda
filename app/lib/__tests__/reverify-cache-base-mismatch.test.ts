import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/app-settings.server', () => ({
  getImplicitApprovalSettings: vi.fn(),
}))

vi.mock('~/db/application-groups.server', () => ({
  propagateVerificationToSiblings: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('~/db/verification-diff.server', () => ({
  getCompareSnapshotForCommit: vi.fn(),
  getPreviousDeploymentForDiff: vi.fn(),
  getPrSnapshotsForDiff: vi.fn(),
}))

vi.mock('~/lib/four-eyes-status', () => ({
  isProtectedStatus: vi.fn().mockReturnValue(false),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('~/lib/verification/fetch-data.server', () => ({
  buildCommitsBetweenFromCache: vi.fn(),
  fetchVerificationData: vi.fn(),
}))

vi.mock('~/lib/verification/store-data.server', () => ({
  storeVerificationResult: vi.fn(),
  updateDeploymentVerification: vi.fn(),
}))

vi.mock('~/lib/verification/verify', () => ({
  verifyDeployment: vi.fn(),
}))

import { getImplicitApprovalSettings } from '~/db/app-settings.server'
import { pool } from '~/db/connection.server'
import { getCompareSnapshotForCommit, getPreviousDeploymentForDiff } from '~/db/verification-diff.server'
import { buildCommitsBetweenFromCache, fetchVerificationData } from '~/lib/verification/fetch-data.server'
import { reverifyDeployment } from '~/lib/verification/index'
import { updateDeploymentVerification } from '~/lib/verification/store-data.server'
import { verifyDeployment } from '~/lib/verification/verify'

const mockPoolQuery = pool.query as Mock
const mockGetCompareSnapshot = getCompareSnapshotForCommit as Mock
const mockGetPreviousDeployment = getPreviousDeploymentForDiff as Mock
const mockGetImplicitApproval = getImplicitApprovalSettings as Mock
const mockFetchVerificationData = fetchVerificationData as Mock
const mockBuildCommitsBetween = buildCommitsBetweenFromCache as Mock
const mockVerifyDeployment = verifyDeployment as Mock
const mockUpdateDeploymentVerification = updateDeploymentVerification as Mock

describe('reverifyDeployment cache base validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to full refetch when cached base_sha mismatches previous deployment', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          commit_sha: 'head123',
          four_eyes_status: 'approved',
          github_pr_number: null,
          environment_name: 'prod-gcp',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          default_branch: 'main',
          audit_start_year: 2026,
        },
      ],
    })
    mockGetImplicitApproval.mockResolvedValue({ mode: 'off' })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'cached-wrong-base',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue({
      id: 9,
      commit_sha: 'expected-base',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockFetchVerificationData.mockResolvedValue({
      deploymentId: 10,
      commitSha: 'head123',
      repository: 'navikt/repo',
      environmentName: 'prod-gcp',
      baseBranch: 'main',
      repositoryStatus: 'active',
      commitOnBaseBranch: null,
      auditStartYear: 2026,
      implicitApprovalSettings: { mode: 'off' },
      previousDeployment: null,
      deployedPr: null,
      commitsBetween: [],
      compareSummary: null,
      dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 4 },
    })
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })
    mockUpdateDeploymentVerification.mockResolvedValue(undefined)

    const result = await reverifyDeployment(10)

    expect(mockFetchVerificationData).toHaveBeenCalledWith(10, 'head123', 'navikt/repo', 'prod-gcp', 'main', 99, {
      forceRefresh: true,
    })
    expect(mockBuildCommitsBetween).not.toHaveBeenCalled()
    expect(result).toEqual({
      changed: false,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
  })
})
