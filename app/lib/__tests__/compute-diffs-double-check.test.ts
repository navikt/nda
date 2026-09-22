import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/repositories.server', () => ({
  getEffectiveSettingsForApp: vi.fn(),
  getRepositoryIdByGithubRepoId: vi.fn(),
}))

vi.mock('~/db/connection.server', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  }
  return {
    pool: {
      connect: vi.fn().mockResolvedValue(mockClient),
      _mockClient: mockClient,
    },
  }
})

vi.mock('~/db/verification-diff.server', () => ({
  getDeploymentsForDiffComputation: vi.fn(),
  getCompareSnapshotForCommit: vi.fn(),
  getPreviousDeploymentForDiff: vi.fn(),
}))

vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('~/lib/verification/fetch-data.server', () => ({
  buildCommitsBetweenFromCache: vi.fn(),
  fetchVerificationData: vi.fn(),
  findPrForCommit: vi.fn(),
  getPrDataForDiff: vi.fn(),
}))

vi.mock('~/lib/verification/verify', () => ({
  verifyDeployment: vi.fn(),
}))

import { findRepositoryForApp } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import { getEffectiveSettingsForApp, getRepositoryIdByGithubRepoId } from '~/db/repositories.server'
import {
  getCompareSnapshotForCommit,
  getDeploymentsForDiffComputation,
  getPreviousDeploymentForDiff,
} from '~/db/verification-diff.server'
import { logger } from '~/lib/logger.server'
import { computeVerificationDiffs } from '~/lib/verification/compute-diffs.server'
import {
  buildCommitsBetweenFromCache,
  fetchVerificationData,
  findPrForCommit,
  getPrDataForDiff,
} from '~/lib/verification/fetch-data.server'
import { verifyDeployment } from '~/lib/verification/verify'

const mockGetDeployments = getDeploymentsForDiffComputation as Mock
const mockGetCompareSnapshot = getCompareSnapshotForCommit as Mock
const mockGetPreviousDeployment = getPreviousDeploymentForDiff as Mock
const mockFindRepositoryForApp = findRepositoryForApp as Mock
const mockGetPrDataForDiff = getPrDataForDiff as Mock
const mockFindPrForCommit = findPrForCommit as Mock
const mockGetEffectiveSettings = getEffectiveSettingsForApp as Mock
const mockGetRepositoryIdByGithubRepoId = getRepositoryIdByGithubRepoId as Mock
const mockBuildCommitsBetween = buildCommitsBetweenFromCache as Mock
const mockFetchVerificationData = fetchVerificationData as Mock
const mockVerifyDeployment = verifyDeployment as Mock
const mockClient = (pool as unknown as { _mockClient: { query: Mock; release: Mock } })._mockClient

function makeDeploymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    commit_sha: 'abc123',
    four_eyes_status: 'approved',
    environment_name: 'prod-gcp',
    detected_github_owner: 'navikt',
    detected_github_repo_name: 'test-repo',
    default_branch: 'main',
    github_pr_number: 100,
    audit_start_year: 2026,
    ...overrides,
  }
}

function makeCompareSnapshot() {
  return {
    base_sha: 'base123',
    data: {
      commits: [
        {
          sha: 'commit1',
          message: 'feat: something',
          authorUsername: 'user1',
          authorDate: '2026-01-01T12:00:00Z',
          committerDate: '2026-01-01T12:00:00Z',
          parentShas: ['parent1'],
          isMergeCommit: false,
          htmlUrl: 'https://github.com/navikt/test-repo/commit/commit1',
        },
      ],
    },
  }
}

function makePrSnapshotMap() {
  return {
    metadata: { title: 'PR', base_branch: 'main', merged_at: '2026-01-01T12:00:00Z' },
    reviews: [{ username: 'reviewer', state: 'APPROVED', submitted_at: '2026-01-01T11:00:00Z' }],
    commits: [{ sha: 'c1', message: 'feat', author: { username: 'user1' }, date: '2026-01-01T10:00:00Z' }],
  }
}

function makeVerificationInput(): Record<string, unknown> {
  return {
    deploymentId: 1,
    commitSha: 'abc123',
    repository: 'navikt/test-repo',
    environmentName: 'prod-gcp',
    baseBranch: 'main',
    repositoryStatus: 'active',
    commitOnBaseBranch: true,
    auditStartYear: 2026,
    implicitApprovalSettings: { mode: 'off' },
    previousDeployment: null,
    deployedPr: { number: 100, url: 'https://github.com/navikt/test-repo/pull/100' },
    commitsBetween: [],
    dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
  }
}

describe('computeVerificationDiffs double-check logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveSettings.mockResolvedValue({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
    mockFindRepositoryForApp.mockResolvedValue({
      repository: { github_repo_id: '123' },
      effectiveOwner: 'navikt',
      effectiveRepo: 'test-repo',
      isRedirected: false,
    })
    mockGetRepositoryIdByGithubRepoId.mockResolvedValue(7)
  })

  it('triggers forceRefresh when cache-only produces different status than stored', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved' })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    const cacheOnlyResult = { status: 'unverified_commits', approvalDetails: { reason: 'no_pr_found' } }
    const freshResult = { status: 'approved', approvalDetails: { reason: 'pr_approved' } }
    const freshInput = makeVerificationInput()

    mockVerifyDeployment.mockReturnValueOnce(cacheOnlyResult).mockReturnValueOnce(freshResult)
    mockFetchVerificationData.mockResolvedValue(freshInput)

    const result = await computeVerificationDiffs(1)

    expect(mockFetchVerificationData).toHaveBeenCalledWith(1, 'abc123', 'navikt/test-repo', 'prod-gcp', 'main', 1, {
      forceRefresh: true,
      includeComments: false,
      includeReviews: false,
    })
    expect(result.diffsFound).toBe(0)
    expect(result.deploymentsChecked).toBe(1)
  })

  it('triggers forceRefresh when PR snapshot is missing despite DB having PR number', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ github_pr_number: 100 })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(null)
    mockBuildCommitsBetween.mockResolvedValue([])

    const verifyResult = { status: 'approved', approvalDetails: { reason: 'pr_approved' } }
    mockVerifyDeployment.mockReturnValue(verifyResult)

    const freshInput = makeVerificationInput()
    mockFetchVerificationData.mockResolvedValue(freshInput)

    await computeVerificationDiffs(1)

    expect(mockFetchVerificationData).toHaveBeenCalledWith(1, 'abc123', 'navikt/test-repo', 'prod-gcp', 'main', 1, {
      forceRefresh: true,
      includeComments: false,
      includeReviews: false,
    })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('missing PR snapshot'))
  })

  it('falls back to cache-only result when forceRefresh fails', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved' })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    const cacheOnlyResult = { status: 'unverified_commits', approvalDetails: { reason: 'no_pr_found' } }
    mockVerifyDeployment.mockReturnValue(cacheOnlyResult)
    mockFetchVerificationData.mockRejectedValue(new Error('GitHub API rate limited'))

    const result = await computeVerificationDiffs(1)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Force-refresh failed'),
      expect.objectContaining({ error: 'GitHub API rate limited' }),
    )
    expect(mockVerifyDeployment).toHaveBeenCalledTimes(1)
    expect(result.diffsFound).toBe(1)
  })

  it('skips forceRefresh when cache-only matches stored status and PR snapshot exists', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved' })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    const verifyResult = { status: 'approved', approvalDetails: { reason: 'pr_approved' } }
    mockVerifyDeployment.mockReturnValue(verifyResult)

    const result = await computeVerificationDiffs(1)

    expect(mockFetchVerificationData).not.toHaveBeenCalled()
    expect(mockVerifyDeployment).toHaveBeenCalledTimes(1)
    expect(result.diffsFound).toBe(0)
  })

  it('discovers PR via cache-only lookup when deployment has no stored github_pr_number', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved', github_pr_number: null })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockFindPrForCommit.mockResolvedValue({ prNumber: 100, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    const verifyResult = {
      status: 'approved',
      approvalDetails: { reason: 'pr_approved' },
      deployedPr: { number: 100 },
    }
    mockVerifyDeployment.mockReturnValue(verifyResult)

    const result = await computeVerificationDiffs(1)

    expect(mockFindPrForCommit).toHaveBeenCalledWith('navikt', 'test-repo', 'abc123', 'main', { cacheOnly: true })
    expect(mockGetPrDataForDiff).toHaveBeenCalledWith('navikt', 'test-repo', 100)
    expect(mockVerifyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ deployedPr: expect.objectContaining({ number: 100 }) }),
    )
    expect(mockFetchVerificationData).not.toHaveBeenCalled()
    expect(result.diffsFound).toBe(1)
  })

  it('surfaces a diff row for PR backfill even when status is unchanged', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved', github_pr_number: null })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockFindPrForCommit.mockResolvedValue({ prNumber: 100, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      approvalDetails: { reason: 'pr_approved' },
      deployedPr: { number: 100 },
    })

    const result = await computeVerificationDiffs(1)

    expect(result.diffsFound).toBe(1)
  })

  it('does not surface a diff row when status is unchanged and PR was already stored', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved', github_pr_number: 100 })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      approvalDetails: { reason: 'pr_approved' },
      deployedPr: { number: 100 },
    })

    const result = await computeVerificationDiffs(1)

    expect(result.diffsFound).toBe(0)
  })

  it('refetches when compare snapshot base_sha does not match previous deployment', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved', commit_sha: 'head123' })])
    mockGetCompareSnapshot.mockResolvedValue({
      ...makeCompareSnapshot(),
      base_sha: 'wrong-base-sha',
    })
    mockGetPreviousDeployment.mockResolvedValue({
      id: 42,
      commit_sha: 'expected-base-sha',
      created_at: new Date('2026-01-01T00:00:00Z'),
    })
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())

    const freshInput = makeVerificationInput()
    mockFetchVerificationData.mockResolvedValue(freshInput)
    mockVerifyDeployment.mockReturnValue({ status: 'approved', approvalDetails: { reason: 'pr_approved' } })

    await computeVerificationDiffs(1)

    expect(mockFetchVerificationData).toHaveBeenCalledWith(1, 'head123', 'navikt/test-repo', 'prod-gcp', 'main', 1)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Cached compare validation failed'))
  })

  it('persists the resolved repository_id on the inserted diff row', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved', github_pr_number: null })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockFindPrForCommit.mockResolvedValue({ prNumber: 100, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])
    mockGetRepositoryIdByGithubRepoId.mockResolvedValue(42)

    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      approvalDetails: { reason: 'pr_approved' },
      deployedPr: { number: 100 },
    })

    const result = await computeVerificationDiffs(1)

    expect(mockGetRepositoryIdByGithubRepoId).toHaveBeenCalledWith('123')
    expect(result.diffsFound).toBe(1)
    const insertCall = mockClient.query.mock.calls.find((call: unknown[]) =>
      (call[0] as string).includes('INSERT INTO verification_diffs'),
    )
    expect(insertCall?.[1]).toEqual([1, 1, 'approved', 'approved', null, 42])
  })

  it('resolves a distinct repository_id per deployment for apps linked to multiple repositories', async () => {
    mockGetDeployments.mockResolvedValue([
      makeDeploymentRow({
        id: 1,
        four_eyes_status: 'approved',
        github_pr_number: null,
        detected_github_repo_name: 'repo-a',
      }),
      makeDeploymentRow({
        id: 2,
        four_eyes_status: 'approved',
        github_pr_number: null,
        detected_github_repo_name: 'repo-b',
      }),
    ])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockFindPrForCommit.mockResolvedValue({ prNumber: 100, mismatchedBaseBranches: [], mismatchedPrNumbers: [] })
    mockGetPrDataForDiff.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    mockFindRepositoryForApp.mockImplementation(async (_appId: number, _owner: string, repo: string) => ({
      repository: { github_repo_id: repo === 'repo-a' ? '111' : '222' },
      effectiveOwner: 'navikt',
      effectiveRepo: repo,
      isRedirected: false,
    }))
    mockGetRepositoryIdByGithubRepoId.mockImplementation(async (githubRepoId: string) =>
      githubRepoId === '111' ? 10 : 20,
    )

    mockVerifyDeployment.mockReturnValue({
      status: 'approved',
      approvalDetails: { reason: 'pr_approved' },
      deployedPr: { number: 100 },
    })

    const result = await computeVerificationDiffs(1)

    expect(result.diffsFound).toBe(2)
    const insertCalls = mockClient.query.mock.calls.filter((call: unknown[]) =>
      (call[0] as string).includes('INSERT INTO verification_diffs'),
    )
    const repositoryIdsByDeployment = new Map(
      insertCalls.map((call: unknown[]) => {
        const params = call[1] as unknown[]
        return [params[1], params[5]]
      }),
    )
    expect(repositoryIdsByDeployment.get(1)).toBe(10)
    expect(repositoryIdsByDeployment.get(2)).toBe(20)
  })
})
