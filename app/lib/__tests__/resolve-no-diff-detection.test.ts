import { describe, expect, it, vi } from 'vitest'
import type { CompareData } from '~/lib/verification/types'

vi.mock('~/db/application-repositories.server', () => ({ findRepositoryForApp: vi.fn() }))
vi.mock('~/db/connection.server', () => ({ pool: { query: vi.fn() } }))
vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  getLatestCompareSnapshot: vi.fn(),
  markPrDataUnavailable: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  saveCompareSnapshot: vi.fn(),
  savePrSnapshotsBatch: vi.fn(),
}))
vi.mock('~/db/sync-jobs.server', () => ({
  heartbeatSyncJob: vi.fn(),
  isSyncJobCancelled: vi.fn(),
  logSyncJobMessage: vi.fn(),
  updateSyncJobProgress: vi.fn(),
}))
vi.mock('~/lib/four-eyes-status', () => ({ APPROVED_STATUSES_SQL: "'approved'", LEGACY_STATUSES_SQL: "'legacy'" }))
vi.mock('~/lib/git-constants', () => ({ VALID_COMMIT_SHA_SQL: 'true' }))
vi.mock('~/lib/github', () => ({
  getCommitsBetween: vi.fn(),
  getDetailedPullRequestInfo: vi.fn(),
  getPullRequestForCommit: vi.fn(),
  haveSameCommitTree: vi.fn(),
  isCommitOnBranch: vi.fn(),
}))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { resolveNoDiffDetection } from '~/lib/verification/fetch-data.server'

function makeCompareData(overrides: Partial<CompareData['compare']> = {}): CompareData {
  return {
    compare: {
      status: 'diverged',
      aheadBy: 0,
      behindBy: 0,
      totalCommits: 0,
      changedFiles: 0,
      noDiffDetected: false,
      ...overrides,
    },
    commits: [],
  }
}

describe('resolveNoDiffDetection', () => {
  it('marks no-diff and persists when compare status is identical', () => {
    const compareData = makeCompareData({ status: 'identical' })
    const result = resolveNoDiffDetection(compareData, 'aaa', 'bbb', null)
    expect(result).toEqual({ noDiffDetected: true, shouldPersistCompare: true })
  })

  it('does not persist compare when tree fallback is inconclusive', () => {
    const compareData = makeCompareData({ status: 'diverged' })
    const result = resolveNoDiffDetection(compareData, 'aaa', 'bbb', null)
    expect(result).toEqual({ noDiffDetected: false, shouldPersistCompare: false })
  })

  it('persists compare when tree fallback is conclusive false', () => {
    const compareData = makeCompareData({ status: 'diverged' })
    const result = resolveNoDiffDetection(compareData, 'aaa', 'bbb', false)
    expect(result).toEqual({ noDiffDetected: false, shouldPersistCompare: true })
  })

  it('marks no-diff and persists when tree fallback is conclusive true', () => {
    const compareData = makeCompareData({ status: 'diverged' })
    const result = resolveNoDiffDetection(compareData, 'aaa', 'bbb', true)
    expect(result).toEqual({ noDiffDetected: true, shouldPersistCompare: true })
  })
})
