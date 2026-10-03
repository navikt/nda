import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/repositories.server', () => ({
  getEffectiveSettingsForApp: vi.fn(),
}))

vi.mock('~/db/monorepo.server', () => ({
  propagateVerificationToSiblings: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('~/db/verification-diff.server', () => ({
  getCompareSnapshotForCommit: vi.fn(),
  getMonorepoComparisonBase: vi.fn(),
  getPreviousDeploymentForDiff: vi.fn(),
}))

vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp: vi.fn(),
  LATEST_ACTIVE_REPOSITORY_LINK_SQL: '',
}))

vi.mock('~/lib/four-eyes-status', () => ({
  APPROVED_STATUSES: [
    'approved',
    'approved_pr',
    'implicitly_approved',
    'manually_approved',
    'no_changes',
    'verified_via_sibling',
    'baseline',
  ],
  ROOT_APPROVED_STATUSES: [
    'approved',
    'approved_pr',
    'implicitly_approved',
    'manually_approved',
    'no_changes',
    'baseline',
  ],
  isProtectedStatus: vi.fn().mockReturnValue(false),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('~/lib/verification/fetch-data.server', () => ({
  buildCommitsBetweenFromCache: vi.fn(),
  fetchVerificationData: vi.fn(),
  findPrForCommit: vi.fn(),
  getPrDataForDiff: vi.fn(),
}))

vi.mock('~/lib/verification/fetch-data/previous-deployment.server', () => ({
  findRootApprovedSiblingForCommit: vi.fn(),
  preferRootApprovedSibling: vi.fn(async (candidate) => candidate),
}))

vi.mock('~/lib/verification/store-data.server', () => ({
  storeVerificationResult: vi.fn(),
  updateDeploymentVerification: vi.fn(),
}))

vi.mock('~/lib/verification/verify', () => ({
  verifyDeployment: vi.fn(),
}))

import { findRepositoryForApp } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import { propagateVerificationToSiblings } from '~/db/monorepo.server'
import { getEffectiveSettingsForApp } from '~/db/repositories.server'
import {
  getCompareSnapshotForCommit,
  getMonorepoComparisonBase,
  getPreviousDeploymentForDiff,
} from '~/db/verification-diff.server'
import { findRootApprovedSiblingForCommit } from '~/lib/verification/fetch-data/previous-deployment.server'
import {
  buildCommitsBetweenFromCache,
  fetchVerificationData,
  findPrForCommit,
  getPrDataForDiff,
} from '~/lib/verification/fetch-data.server'
import { reverifyDeployment } from '~/lib/verification/index'
import { updateDeploymentVerification } from '~/lib/verification/store-data.server'
import { verifyDeployment } from '~/lib/verification/verify'

const mockPoolQuery = pool.query as Mock
const mockPropagateVerification = propagateVerificationToSiblings as Mock
const mockGetComparisonBase = getMonorepoComparisonBase as Mock
const mockFindRootApprovedSibling = findRootApprovedSiblingForCommit as Mock
const mockGetCompareSnapshot = getCompareSnapshotForCommit as Mock
const mockGetPreviousDeployment = getPreviousDeploymentForDiff as Mock
const mockFindRepositoryForApp = findRepositoryForApp as Mock
const mockGetEffectiveSettings = getEffectiveSettingsForApp as Mock
const mockFetchVerificationData = fetchVerificationData as Mock
const mockFindPrForCommit = findPrForCommit as Mock
const mockGetPrDataForDiff = getPrDataForDiff as Mock
const mockBuildCommitsBetween = buildCommitsBetweenFromCache as Mock
const mockVerifyDeployment = verifyDeployment as Mock
const mockUpdateDeploymentVerification = updateDeploymentVerification as Mock

describe('reverifyDeployment cache base validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetComparisonBase.mockResolvedValue(null)
    mockFindRootApprovedSibling.mockResolvedValue(null)
    mockFindRepositoryForApp.mockResolvedValue({
      repository: { github_repo_id: '123' },
      effectiveOwner: 'navikt',
      effectiveRepo: 'repo',
      isRedirected: false,
    })
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
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'cached-wrong-base',
      data: { commits: [] },
    })
    mockGetComparisonBase.mockResolvedValue({
      commit_sha: 'expected-base',
      created_at: new Date('2026-01-01T00:00:00Z'),
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
      includeComments: false,
      includeReviews: false,
    })
    expect(mockBuildCommitsBetween).not.toHaveBeenCalled()
    expect(result).toEqual({
      changed: false,
      prBackfilled: false,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
  })

  it('falls back to full refetch when the exact app-local compare snapshot is missing', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 14,
          commit_sha: 'head-missing-snapshot',
          four_eyes_status: 'pending',
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
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetComparisonBase.mockResolvedValue({
      commit_sha: 'expected-base',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetCompareSnapshot.mockResolvedValue(null)
    mockFetchVerificationData.mockResolvedValue({
      deploymentId: 14,
      commitSha: 'head-missing-snapshot',
      repository: 'navikt/repo',
      environmentName: 'prod-gcp',
      baseBranch: 'main',
      repositoryStatus: 'active',
      commitOnBaseBranch: null,
      auditStartYear: 2026,
      implicitApprovalSettings: { mode: 'off' },
      previousDeployment: null,
      comparisonBaseSha: 'expected-base',
      deployedPr: null,
      commitsBetween: [],
      compareSummary: null,
      dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 4 },
    })
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })
    mockUpdateDeploymentVerification.mockResolvedValue(undefined)

    await reverifyDeployment(14)

    expect(mockFetchVerificationData).toHaveBeenCalledWith(
      14,
      'head-missing-snapshot',
      'navikt/repo',
      'prod-gcp',
      'main',
      99,
      { forceRefresh: true, includeComments: false, includeReviews: false },
    )
    expect(mockBuildCommitsBetween).not.toHaveBeenCalled()
    expect(mockVerifyDeployment).toHaveBeenCalledWith(expect.objectContaining({ comparisonBaseSha: 'expected-base' }))
  })

  it('uses the resolved app-local base to find an approved sibling root during reverification', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          commit_sha: 'head123',
          four_eyes_status: 'pending',
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
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetComparisonBase.mockResolvedValue({
      commit_sha: 'app-base-sha',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockFindRootApprovedSibling.mockResolvedValue({
      id: 12,
      monitoredAppId: 100,
      fourEyesStatus: 'approved',
      comparisonBaseSha: 'app-base-sha',
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'app-base-sha',
      data: { commits: [] },
    })
    mockFindPrForCommit.mockResolvedValue({ prNumber: null, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({ status: 'verified_via_sibling', unverifiedCommits: [] })
    mockUpdateDeploymentVerification.mockResolvedValue(undefined)

    await reverifyDeployment(10)

    expect(mockFindRootApprovedSibling).toHaveBeenCalledWith('head123', '123', 'app-base-sha', 10, 99)
    expect(mockVerifyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        comparisonBaseSha: 'app-base-sha',
        previousDeployment: expect.objectContaining({
          id: 12,
          monitoredAppId: 100,
          comparisonBaseSha: 'app-base-sha',
        }),
      }),
    )
  })

  it('propagates a root approval when reverification confirms a null base without a status change', async () => {
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
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetComparisonBase.mockResolvedValue(null)
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetCompareSnapshot.mockResolvedValue(null)
    mockFetchVerificationData.mockResolvedValue({
      deploymentId: 10,
      commitSha: 'head123',
      repository: 'navikt/repo',
      environmentName: 'prod-gcp',
      baseBranch: 'main',
      repositoryStatus: 'active',
      commitOnBaseBranch: true,
      auditStartYear: 2026,
      implicitApprovalSettings: { mode: 'off' },
      previousDeployment: null,
      comparisonBaseSha: null,
      deployedPr: null,
      commitsBetween: [],
      compareSummary: null,
      dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 4 },
    })
    mockVerifyDeployment.mockReturnValue({ status: 'approved', hasFourEyes: true, unverifiedCommits: [] })
    mockUpdateDeploymentVerification.mockResolvedValue(true)

    const result = await reverifyDeployment(10)

    expect(result).toEqual({
      changed: false,
      prBackfilled: false,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
    expect(mockPropagateVerification).toHaveBeenCalledWith(10, 'approved', 'head123', 99, true)
  })

  it('uses baseline verification when there is no earlier distinct commit', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 13,
          commit_sha: 'head-no-base',
          four_eyes_status: 'pending',
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
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockGetComparisonBase.mockResolvedValue(null)
    mockGetPreviousDeployment.mockResolvedValue({
      id: 8,
      commit_sha: 'sibling-sha',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockFetchVerificationData.mockResolvedValue({
      deploymentId: 13,
      commitSha: 'head-no-base',
      repository: 'navikt/repo',
      environmentName: 'prod-gcp',
      baseBranch: 'main',
      repositoryStatus: 'active',
      commitOnBaseBranch: true,
      auditStartYear: 2026,
      implicitApprovalSettings: { mode: 'off' },
      monitoredAppId: 99,
      previousDeployment: null,
      comparisonBaseSha: null,
      deployedPr: null,
      commitsBetween: [],
      compareSummary: null,
      dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
    })
    mockVerifyDeployment.mockReturnValue({ status: 'pending_baseline', unverifiedCommits: [] })
    mockUpdateDeploymentVerification.mockResolvedValue(undefined)

    await reverifyDeployment(13)

    expect(mockGetPreviousDeployment).toHaveBeenCalledWith(13, '123')
    expect(mockGetCompareSnapshot).not.toHaveBeenCalled()
    expect(mockFetchVerificationData).toHaveBeenCalledWith(13, 'head-no-base', 'navikt/repo', 'prod-gcp', 'main', 99)
    expect(mockVerifyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ previousDeployment: null, comparisonBaseSha: null }),
    )
  })

  it('discovers PR via cache-only lookup when deployment has no stored github_pr_number', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          commit_sha: 'head456',
          four_eyes_status: 'unverified_commits',
          github_pr_number: null,
          environment_name: 'prod-fss',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          default_branch: 'master',
          audit_start_year: 2026,
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
    mockGetComparisonBase.mockResolvedValue({
      commit_sha: 'head456',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'head456',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockFindPrForCommit.mockResolvedValue({ prNumber: 1812, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockGetPrDataForDiff.mockResolvedValue({
      metadata: { title: 'PR', baseBranch: 'master' },
      reviews: [{ username: 'reviewer', state: 'APPROVED' }],
      commits: [{ sha: 'head456', message: 'bump' }],
    })
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })
    mockUpdateDeploymentVerification.mockResolvedValue(undefined)

    await reverifyDeployment(11)

    expect(mockFindPrForCommit).toHaveBeenCalledWith('navikt', 'repo', 'head456', 'master', { cacheOnly: true })
    expect(mockGetPrDataForDiff).toHaveBeenCalledWith('navikt', 'repo', 1812)
    expect(mockVerifyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ deployedPr: expect.objectContaining({ number: 1812 }) }),
    )
  })

  it('reports prBackfilled and persists via updateDeploymentVerification when status is unchanged but PR is newly discovered', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 12,
          commit_sha: 'head789',
          four_eyes_status: 'approved',
          github_pr_number: null,
          environment_name: 'prod-fss',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          default_branch: 'master',
          audit_start_year: 2026,
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
    mockGetComparisonBase.mockResolvedValue({
      commit_sha: 'head789',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'head789',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockFindPrForCommit.mockResolvedValue({ prNumber: 1812, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockGetPrDataForDiff.mockResolvedValue({
      metadata: { title: 'PR', baseBranch: 'master' },
      reviews: [{ username: 'reviewer', state: 'APPROVED' }],
      commits: [{ sha: 'head789', message: 'bump' }],
    })
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      unverifiedCommits: [],
      deployedPr: { number: 1812 },
    })
    mockUpdateDeploymentVerification.mockResolvedValue(true)

    const result = await reverifyDeployment(12)

    expect(mockUpdateDeploymentVerification).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ status: 'approved', deployedPr: expect.objectContaining({ number: 1812 }) }),
      'reverification',
    )
    expect(result).toEqual({
      changed: false,
      prBackfilled: true,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
  })

  it('does not report prBackfilled when the deployment update affects zero rows (e.g. status became protected mid-flight)', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 13,
          commit_sha: 'head999',
          four_eyes_status: 'approved',
          github_pr_number: null,
          environment_name: 'prod-fss',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          default_branch: 'master',
          audit_start_year: 2026,
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
    mockGetComparisonBase.mockResolvedValue({
      commit_sha: 'head999',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'head999',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockFindPrForCommit.mockResolvedValue({ prNumber: 1900, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockGetPrDataForDiff.mockResolvedValue({
      metadata: { title: 'PR', baseBranch: 'master' },
      reviews: [{ username: 'reviewer', state: 'APPROVED' }],
      commits: [{ sha: 'head999', message: 'bump' }],
    })
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      unverifiedCommits: [],
      deployedPr: { number: 1900 },
    })
    mockUpdateDeploymentVerification.mockResolvedValue(false)

    const result = await reverifyDeployment(13)

    expect(result).toEqual({
      changed: false,
      prBackfilled: false,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
  })
})
