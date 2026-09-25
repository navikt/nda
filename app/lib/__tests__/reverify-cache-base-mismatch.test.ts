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

vi.mock('~/lib/verification/store-data.server', () => ({
  storeVerificationResult: vi.fn(),
  updateDeploymentVerification: vi.fn(),
}))

vi.mock('~/lib/verification/verify', () => ({
  verifyDeployment: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getMergedPullRequestsInWindow: vi.fn(),
  resolveGithubRepoIdFromWorkflowRunDetailed: vi.fn().mockResolvedValue({ repositoryId: null, permanentFailure: true }),
}))

import { findRepositoryForApp } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import { getEffectiveSettingsForApp } from '~/db/repositories.server'
import { getCompareSnapshotForCommit, getPreviousDeploymentForDiff } from '~/db/verification-diff.server'
import { resolveGithubRepoIdFromWorkflowRunDetailed } from '~/lib/github'
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
const mockResolveGithubRepoId = resolveGithubRepoIdFromWorkflowRunDetailed as Mock

describe('reverifyDeployment cache base validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
          trigger_url: 'https://github.com/navikt/repo/actions/runs/555',
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

    expect(mockFetchVerificationData).toHaveBeenCalledWith(
      10,
      'head123',
      'navikt/repo',
      'prod-gcp',
      'main',
      99,
      {
        forceRefresh: true,
        includeComments: false,
        includeReviews: false,
      },
      'https://github.com/navikt/repo/actions/runs/555',
    )
    expect(mockBuildCommitsBetween).not.toHaveBeenCalled()
    expect(result).toEqual({
      changed: false,
      prBackfilled: false,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
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
          github_repo_id: '123',
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
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
      expect.objectContaining({ deployedPr: expect.objectContaining({ number: 1812 }), detectedGithubRepoId: 123 }),
    )
  })

  it('resolves detectedGithubRepoId from the workflow run when the deployment has no persisted id yet, never from the current owner/name link', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 13,
          commit_sha: 'head999',
          four_eyes_status: 'unverified_commits',
          github_pr_number: 1900,
          environment_name: 'prod-fss',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          trigger_url: 'https://github.com/navikt/repo/actions/runs/999',
          default_branch: 'master',
          audit_start_year: 2026,
          github_repo_id: null,
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'head999',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(null)
    mockBuildCommitsBetween.mockResolvedValue([])
    mockResolveGithubRepoId.mockResolvedValueOnce({ repositoryId: 123, permanentFailure: false })
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })
    mockUpdateDeploymentVerification.mockResolvedValue(undefined)

    await reverifyDeployment(13)

    expect(mockResolveGithubRepoId).toHaveBeenCalledWith(
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/999',
    )
    expect(mockVerifyDeployment).toHaveBeenCalledWith(expect.objectContaining({ detectedGithubRepoId: 123 }))
  })

  it('returns null without re-verifying when the resolved github_repo_id from the workflow run mismatches the currently linked repository', async () => {
    mockFindRepositoryForApp.mockResolvedValue({
      repository: { github_repo_id: '123' },
      effectiveOwner: 'navikt',
      effectiveRepo: 'repo',
      isRedirected: false,
    })
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 16,
          commit_sha: 'head333',
          four_eyes_status: 'unverified_commits',
          github_pr_number: 1902,
          environment_name: 'prod-fss',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          trigger_url: 'https://github.com/navikt/repo/actions/runs/333',
          default_branch: 'master',
          audit_start_year: 2026,
          github_repo_id: null,
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'head333',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(null)
    mockBuildCommitsBetween.mockResolvedValue([])
    mockResolveGithubRepoId.mockResolvedValueOnce({ repositoryId: 555, permanentFailure: false })

    const result = await reverifyDeployment(16)

    expect(result).toBeNull()
    expect(mockVerifyDeployment).not.toHaveBeenCalled()
    expect(mockUpdateDeploymentVerification).not.toHaveBeenCalled()
  })

  it('returns null without re-verifying when the workflow run resolution fails for a deployment with no persisted github_repo_id', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 15,
          commit_sha: 'head222',
          four_eyes_status: 'unverified_commits',
          github_pr_number: 1901,
          environment_name: 'prod-fss',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          trigger_url: 'https://github.com/navikt/repo/actions/runs/222',
          default_branch: 'master',
          audit_start_year: 2026,
          github_repo_id: null,
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'head222',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(null)
    mockBuildCommitsBetween.mockResolvedValue([])
    mockResolveGithubRepoId.mockResolvedValueOnce({ repositoryId: null, permanentFailure: true })

    const result = await reverifyDeployment(15)

    expect(result).toBeNull()
    expect(mockVerifyDeployment).not.toHaveBeenCalled()
  })

  it('uses the deployment own github_repo_id as the anchor when it disagrees with the currently linked repository', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 14,
          commit_sha: 'head111',
          four_eyes_status: 'unverified_commits',
          github_pr_number: null,
          environment_name: 'prod-fss',
          monitored_app_id: 99,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'repo',
          trigger_url: 'https://github.com/navikt/repo/actions/runs/111',
          default_branch: 'master',
          audit_start_year: 2026,
          github_repo_id: '999',
        },
      ],
    })
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'head111',
      data: { commits: [] },
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(null)
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })

    const result = await reverifyDeployment(14)

    expect(mockGetPreviousDeployment).toHaveBeenCalledWith(14, '999')
    expect(mockVerifyDeployment).toHaveBeenCalledWith(expect.objectContaining({ detectedGithubRepoId: 999 }))
    expect(result).toEqual(
      expect.objectContaining({ changed: true, oldStatus: 'unverified_commits', newStatus: 'approved' }),
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
