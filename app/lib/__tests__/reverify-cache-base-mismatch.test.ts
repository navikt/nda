import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  saveVerificationRun: vi.fn(),
}))

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

vi.mock('~/lib/four-eyes-status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/four-eyes-status')>()),
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
import { reverifyDeployment, runVerification } from '~/lib/verification/index'
import { storeVerificationResult } from '~/lib/verification/store-data.server'
import type { VerificationInput } from '~/lib/verification/types'
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
const mockStoreVerificationResult = storeVerificationResult as Mock

interface ReverificationDeployment {
  id: number
  commit_sha: string
  four_eyes_status: string
  github_pr_number: number | null
  environment_name: string
  monitored_app_id: number
  detected_github_owner: string
  detected_github_repo_name: string
  default_branch: string
  audit_start_year: number
}

function mockDeployment(overrides: Partial<ReverificationDeployment> = {}): ReverificationDeployment {
  const deployment = {
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
    ...overrides,
  }
  mockPoolQuery.mockResolvedValueOnce({ rows: [deployment] })
  mockGetEffectiveSettings.mockResolvedValue({
    repositoryId: null,
    auditStartYear: null,
    implicitApprovalSettings: { mode: 'off' },
    defaultBranch: deployment.default_branch,
  })
  return deployment
}

function mockComparisonBase(commitSha: string | null): void {
  mockGetComparisonBase.mockResolvedValue(
    commitSha ? { commit_sha: commitSha, created_at: new Date('2026-01-01T00:00:00Z') } : null,
  )
}

function mockCompareSnapshot(baseSha: string): void {
  mockGetCompareSnapshot.mockResolvedValue({ base_sha: baseSha, data: { commits: [] } })
}

function mockVerificationData(overrides: Partial<VerificationInput> = {}): void {
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
    comparisonBaseSha: null,
    deployedPr: null,
    commitsBetween: [],
    compareSummary: null,
    dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 4 },
    ...overrides,
  })
}

function mockPullRequest(prNumber: number, commitSha: string, baseBranch: string): void {
  mockFindPrForCommit.mockResolvedValue({ prNumber, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
  mockGetPrDataForDiff.mockResolvedValue({
    metadata: { title: 'PR', baseBranch },
    reviews: [{ username: 'reviewer', state: 'APPROVED' }],
    commits: [{ sha: commitSha, message: 'bump' }],
  })
}

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
    mockDeployment({ four_eyes_status: 'approved' })
    mockGetCompareSnapshot.mockResolvedValue({
      base_sha: 'cached-wrong-base',
      data: { commits: [] },
    })
    mockComparisonBase('expected-base')
    mockGetPreviousDeployment.mockResolvedValue({
      id: 9,
      commit_sha: 'expected-base',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockVerificationData()
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })
    mockStoreVerificationResult.mockResolvedValue(undefined)

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
    mockDeployment({ id: 14, commit_sha: 'head-missing-snapshot' })
    mockComparisonBase('expected-base')
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetCompareSnapshot.mockResolvedValue(null)
    mockVerificationData({
      deploymentId: 14,
      commitSha: 'head-missing-snapshot',
      comparisonBaseSha: 'expected-base',
    })
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })
    mockStoreVerificationResult.mockResolvedValue(undefined)

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
    mockDeployment()
    mockComparisonBase('app-base-sha')
    mockFindRootApprovedSibling.mockResolvedValue({
      id: 12,
      monitoredAppId: 100,
      fourEyesStatus: 'approved',
      comparisonBaseSha: 'app-base-sha',
      createdAt: '2026-01-02T00:00:00.000Z',
    })

    mockGetPreviousDeployment.mockResolvedValue(null)
    mockCompareSnapshot('app-base-sha')
    mockFindPrForCommit.mockResolvedValue({ prNumber: null, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({ status: 'verified_via_sibling', unverifiedCommits: [] })
    mockStoreVerificationResult.mockResolvedValue(undefined)

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

  it('passes same-app redeploy detection through cached reverification without changing the monorepo base', async () => {
    mockDeployment({ four_eyes_status: 'no_changes' })
    mockGetComparisonBase.mockResolvedValue({
      commit_sha: 'repo-base',
      created_at: new Date('2026-01-01T00:00:00Z'),
      is_same_app_redeploy: true,
    })
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockCompareSnapshot('repo-base')
    mockFindPrForCommit.mockResolvedValue({ prNumber: null, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({ status: 'no_changes', unverifiedCommits: [] })
    mockStoreVerificationResult.mockResolvedValue({ verificationRunId: 1 })

    await reverifyDeployment(10)

    expect(mockVerifyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        comparisonBaseSha: 'repo-base',
        isSameAppRedeploy: true,
      }),
    )
    expect(mockFetchVerificationData).not.toHaveBeenCalled()
    expect(storeVerificationResult).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ isSameAppRedeploy: true }),
      { prSnapshotIds: [], commitSnapshotIds: [] },
      'reverification',
    )
  })

  it('propagates a root approval when reverification confirms a null base without a status change', async () => {
    mockDeployment({ four_eyes_status: 'approved' })
    mockComparisonBase(null)
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetCompareSnapshot.mockResolvedValue(null)
    mockVerificationData({ commitOnBaseBranch: true })
    mockVerifyDeployment.mockReturnValue({ status: 'approved', hasFourEyes: true, unverifiedCommits: [] })
    mockStoreVerificationResult.mockResolvedValue({ verificationRunId: 1 })

    const result = await reverifyDeployment(10)

    expect(result).toEqual({
      changed: false,
      prBackfilled: false,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
    expect(mockPropagateVerification).toHaveBeenCalledWith(10, 'approved', 'head123', 99, true)
    expect(storeVerificationResult).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        status: 'approved',
        comparisonRange: { baseSha: null, headSha: 'head123' },
        isSameAppRedeploy: false,
      }),
      { prSnapshotIds: [], commitSnapshotIds: [] },
      'reverification',
    )
  })

  it('uses baseline verification when there is no earlier distinct commit', async () => {
    mockDeployment({ id: 13, commit_sha: 'head-no-base' })
    mockComparisonBase(null)
    mockGetPreviousDeployment.mockResolvedValue({
      id: 8,
      commit_sha: 'sibling-sha',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockVerificationData({
      deploymentId: 13,
      commitSha: 'head-no-base',
      commitOnBaseBranch: true,
      monitoredAppId: 99,
      dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
    })
    mockVerifyDeployment.mockReturnValue({ status: 'pending_baseline', unverifiedCommits: [] })
    mockStoreVerificationResult.mockResolvedValue(undefined)

    await reverifyDeployment(13)

    expect(mockGetPreviousDeployment).toHaveBeenCalledWith(13, '123')
    expect(mockGetCompareSnapshot).not.toHaveBeenCalled()
    expect(mockFetchVerificationData).toHaveBeenCalledWith(13, 'head-no-base', 'navikt/repo', 'prod-gcp', 'main', 99)
    expect(mockVerifyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ previousDeployment: null, comparisonBaseSha: null }),
    )
  })

  it('discovers PR via cache-only lookup when deployment has no stored github_pr_number', async () => {
    mockDeployment({
      id: 11,
      commit_sha: 'head456',
      four_eyes_status: 'unverified_commits',
      environment_name: 'prod-fss',
      default_branch: 'master',
    })
    mockComparisonBase('head456')
    mockCompareSnapshot('head456')
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockPullRequest(1812, 'head456', 'master')
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({ status: 'approved', unverifiedCommits: [] })
    mockStoreVerificationResult.mockResolvedValue(undefined)

    await reverifyDeployment(11)

    expect(mockFindPrForCommit).toHaveBeenCalledWith('navikt', 'repo', 'head456', 'master', { cacheOnly: true })
    expect(mockGetPrDataForDiff).toHaveBeenCalledWith('navikt', 'repo', 1812)
    expect(mockVerifyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ deployedPr: expect.objectContaining({ number: 1812 }) }),
    )
  })

  it('reports prBackfilled after atomic persistence when status is unchanged but PR is newly discovered', async () => {
    mockDeployment({
      id: 12,
      commit_sha: 'head789',
      four_eyes_status: 'approved',
      environment_name: 'prod-fss',
      default_branch: 'master',
    })
    mockComparisonBase('head789')
    mockCompareSnapshot('head789')
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockPullRequest(1812, 'head789', 'master')
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      unverifiedCommits: [],
      deployedPr: { number: 1812 },
    })
    mockStoreVerificationResult.mockResolvedValue({ verificationRunId: 1 })

    const result = await reverifyDeployment(12)

    expect(mockStoreVerificationResult).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ status: 'approved', deployedPr: expect.objectContaining({ number: 1812 }) }),
      { prSnapshotIds: [], commitSnapshotIds: [] },
      'reverification',
    )
    expect(result).toEqual({
      changed: false,
      prBackfilled: true,
      oldStatus: 'approved',
      newStatus: 'approved',
    })
  })

  it('does not propagate a verification whose persistence was rejected', async () => {
    mockVerificationData()
    mockVerifyDeployment.mockReturnValue({ status: 'approved', hasFourEyes: true, unverifiedCommits: [] })
    mockStoreVerificationResult.mockRejectedValueOnce(new Error('Godkjenningen er beskyttet'))

    await expect(
      runVerification(10, {
        commitSha: 'head123',
        repository: 'navikt/repo',
        environmentName: 'prod-gcp',
        baseBranch: 'main',
        monitoredAppId: 99,
      }),
    ).rejects.toThrow('Godkjenningen er beskyttet')
    expect(mockPropagateVerification).not.toHaveBeenCalled()
  })

  it('rejects reverification and does not propagate when status became protected mid-flight', async () => {
    mockDeployment({
      id: 13,
      commit_sha: 'head999',
      four_eyes_status: 'approved',
      environment_name: 'prod-fss',
      default_branch: 'master',
    })
    mockComparisonBase('head999')
    mockCompareSnapshot('head999')
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockPullRequest(1900, 'head999', 'master')
    mockBuildCommitsBetween.mockResolvedValue([])
    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      unverifiedCommits: [],
      deployedPr: { number: 1900 },
    })
    mockStoreVerificationResult.mockRejectedValueOnce(new Error('Godkjenningen er beskyttet'))

    await expect(reverifyDeployment(13)).rejects.toThrow('Godkjenningen er beskyttet')
    expect(mockPropagateVerification).not.toHaveBeenCalled()
  })
})
