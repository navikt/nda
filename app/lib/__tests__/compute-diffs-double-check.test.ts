/**
 * Unit tests for the double-check logic in computeVerificationDiffs.
 *
 * Tests that when cache-only verification detects a status diff or missing
 * PR snapshot, forceRefresh is attempted. Also tests fallback to cache-only
 * result when forceRefresh fails.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Mock DB modules
vi.mock('~/db/app-settings.server', () => ({
  getImplicitApprovalSettings: vi.fn(),
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
  getPrSnapshotsForDiff: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('~/lib/verification/fetch-data.server', () => ({
  buildCommitsBetweenFromCache: vi.fn(),
  fetchVerificationData: vi.fn(),
}))

vi.mock('~/lib/verification/verify', () => ({
  verifyDeployment: vi.fn(),
}))

import { getImplicitApprovalSettings } from '~/db/app-settings.server'
import {
  getCompareSnapshotForCommit,
  getDeploymentsForDiffComputation,
  getPreviousDeploymentForDiff,
  getPrSnapshotsForDiff,
} from '~/db/verification-diff.server'
import { logger } from '~/lib/logger.server'
import { computeVerificationDiffs } from '~/lib/verification/compute-diffs.server'
import { buildCommitsBetweenFromCache, fetchVerificationData } from '~/lib/verification/fetch-data.server'
import { verifyDeployment } from '~/lib/verification/verify'

const mockGetDeployments = getDeploymentsForDiffComputation as Mock
const mockGetCompareSnapshot = getCompareSnapshotForCommit as Mock
const mockGetPreviousDeployment = getPreviousDeploymentForDiff as Mock
const mockGetPrSnapshots = getPrSnapshotsForDiff as Mock
const mockGetImplicitApproval = getImplicitApprovalSettings as Mock
const mockBuildCommitsBetween = buildCommitsBetweenFromCache as Mock
const mockFetchVerificationData = fetchVerificationData as Mock
const mockVerifyDeployment = verifyDeployment as Mock

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
  const map = new Map()
  map.set('metadata', { title: 'PR', base_branch: 'main', merged_at: '2026-01-01T12:00:00Z' })
  map.set('reviews', [{ username: 'reviewer', state: 'APPROVED', submitted_at: '2026-01-01T11:00:00Z' }])
  map.set('commits', [{ sha: 'c1', message: 'feat', author: { username: 'user1' }, date: '2026-01-01T10:00:00Z' }])
  return map
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
    mockGetImplicitApproval.mockResolvedValue(null)
  })

  it('triggers forceRefresh when cache-only produces different status than stored', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved' })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrSnapshots.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    // Cache-only verification says "unverified_commits" (differs from stored "approved")
    const cacheOnlyResult = { status: 'unverified_commits', approvalDetails: { reason: 'no_pr_found' } }
    // After forceRefresh, verification says "approved" (healed)
    const freshResult = { status: 'approved', approvalDetails: { reason: 'pr_approved' } }
    const freshInput = makeVerificationInput()

    mockVerifyDeployment.mockReturnValueOnce(cacheOnlyResult).mockReturnValueOnce(freshResult)
    mockFetchVerificationData.mockResolvedValue(freshInput)

    const result = await computeVerificationDiffs(1)

    // Should have called fetchVerificationData with forceRefresh: true
    expect(mockFetchVerificationData).toHaveBeenCalledWith(1, 'abc123', 'navikt/test-repo', 'prod-gcp', 'main', 1, {
      forceRefresh: true,
    })
    // After healing, no diff (approved → approved)
    expect(result.diffsFound).toBe(0)
    expect(result.deploymentsChecked).toBe(1)
  })

  it('triggers forceRefresh when PR snapshot is missing despite DB having PR number', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ github_pr_number: 100 })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    // PR snapshots are incomplete — missing metadata/reviews/commits
    mockGetPrSnapshots.mockResolvedValue(new Map())
    mockBuildCommitsBetween.mockResolvedValue([])

    // Both cache-only and fresh produce same status, but missingPrSnapshot triggers refresh
    const verifyResult = { status: 'approved', approvalDetails: { reason: 'pr_approved' } }
    mockVerifyDeployment.mockReturnValue(verifyResult)

    const freshInput = makeVerificationInput()
    mockFetchVerificationData.mockResolvedValue(freshInput)

    await computeVerificationDiffs(1)

    expect(mockFetchVerificationData).toHaveBeenCalledWith(1, 'abc123', 'navikt/test-repo', 'prod-gcp', 'main', 1, {
      forceRefresh: true,
    })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('missing PR snapshot'))
  })

  it('falls back to cache-only result when forceRefresh fails', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved' })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrSnapshots.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    // Cache-only says "unverified_commits" (triggers forceRefresh)
    const cacheOnlyResult = { status: 'unverified_commits', approvalDetails: { reason: 'no_pr_found' } }
    mockVerifyDeployment.mockReturnValue(cacheOnlyResult)
    // forceRefresh fails (e.g. deleted PR, API error)
    mockFetchVerificationData.mockRejectedValue(new Error('GitHub API rate limited'))

    const result = await computeVerificationDiffs(1)

    // Should log warning about fallback
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Force-refresh failed'),
      expect.objectContaining({ error: 'GitHub API rate limited' }),
    )
    // verifyDeployment should NOT be called a second time (precomputedResult used)
    expect(mockVerifyDeployment).toHaveBeenCalledTimes(1)
    // Diff still recorded (cache-only result differs from stored)
    expect(result.diffsFound).toBe(1)
  })

  it('skips forceRefresh when cache-only matches stored status and PR snapshot exists', async () => {
    mockGetDeployments.mockResolvedValue([makeDeploymentRow({ four_eyes_status: 'approved' })])
    mockGetCompareSnapshot.mockResolvedValue(makeCompareSnapshot())
    mockGetPreviousDeployment.mockResolvedValue(null)
    mockGetPrSnapshots.mockResolvedValue(makePrSnapshotMap())
    mockBuildCommitsBetween.mockResolvedValue([])

    // Cache-only matches stored status — no reason to forceRefresh
    const verifyResult = { status: 'approved', approvalDetails: { reason: 'pr_approved' } }
    mockVerifyDeployment.mockReturnValue(verifyResult)

    const result = await computeVerificationDiffs(1)

    // Should NOT call fetchVerificationData (no forceRefresh needed)
    expect(mockFetchVerificationData).not.toHaveBeenCalled()
    // verifyDeployment called only once (cache-only, then precomputedResult reused)
    expect(mockVerifyDeployment).toHaveBeenCalledTimes(1)
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
    mockGetPrSnapshots.mockResolvedValue(makePrSnapshotMap())

    const freshInput = makeVerificationInput()
    mockFetchVerificationData.mockResolvedValue(freshInput)
    mockVerifyDeployment.mockReturnValue({ status: 'approved', approvalDetails: { reason: 'pr_approved' } })

    await computeVerificationDiffs(1)

    expect(mockFetchVerificationData).toHaveBeenCalledWith(1, 'head123', 'navikt/test-repo', 'prod-gcp', 'main', 1)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Cached compare validation failed'))
  })
})
