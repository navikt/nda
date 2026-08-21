import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery, mockGetChecksForCommit, mockSaveCommitSnapshot, mockUpdateDeploymentCommitChecks } = vi.hoisted(
  () => ({
    mockPoolQuery: vi.fn(),
    mockGetChecksForCommit: vi.fn(),
    mockSaveCommitSnapshot: vi.fn(),
    mockUpdateDeploymentCommitChecks: vi.fn(),
  }),
)

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getBranchFromWorkflowRun: vi.fn(),
  getChecksForCommit: mockGetChecksForCommit,
  getCommitsBetween: vi.fn(),
  getDetailedPullRequestInfo: vi.fn(),
  getPullRequestForCommit: vi.fn(),
  getSingleCommitMessage: vi.fn(),
  getWorkflowTriggerConfig: vi.fn(),
  haveSameCommitTree: vi.fn(),
  isCommitOnBranch: vi.fn(),
  WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION: 1,
}))

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  getLatestCompareSnapshot: vi.fn(),
  markPrDataUnavailable: vi.fn(),
  saveCommitSnapshot: mockSaveCommitSnapshot,
  saveCompareSnapshot: vi.fn(),
  savePrSnapshotsBatch: vi.fn(),
}))

vi.mock('~/db/sync-jobs.server', () => ({
  heartbeatSyncJob: vi.fn(),
  isSyncJobCancelled: vi.fn().mockResolvedValue(false),
  logSyncJobMessage: vi.fn(),
  updateSyncJobProgress: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('~/lib/verification/store-data.server', () => ({
  updateDeploymentCommitChecks: mockUpdateDeploymentCommitChecks,
}))

import { fetchVerificationDataForAllDeployments } from '~/lib/verification/fetch-data.server'

function baseDeploymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    commit_sha: 'a'.repeat(40),
    detected_github_owner: 'navikt',
    detected_github_repo_name: 'nda',
    environment_name: 'prod-gcp',
    trigger_url: null,
    workflow_trigger_config: null,
    commit_checks_data: null,
    default_branch: 'main',
    created_at: new Date(),
    prev_commit_sha: null,
    has_pr_snapshot: true,
    has_compare_snapshot: true,
    has_checks_data: false,
    ...overrides,
  }
}

describe('fetchVerificationDataForAllDeployments checks backfill', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
    mockGetChecksForCommit.mockReset()
    mockSaveCommitSnapshot.mockReset()
    mockUpdateDeploymentCommitChecks.mockReset()
  })

  it('skips deployments that already have PR/compare data and commit_checks_data', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ audit_start_year: null }] }) // monitored_applications lookup
      .mockResolvedValueOnce({ rows: [] }) // app_settings lookup
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: true })] }) // deployments query

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.skipped).toBe(1)
    expect(result.fetched).toBe(0)
    expect(mockGetChecksForCommit).not.toHaveBeenCalled()
    expect(mockUpdateDeploymentCommitChecks).not.toHaveBeenCalled()
  })

  it('backfills only commit_checks_data for deployments with PR/compare data but no checks yet', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ audit_start_year: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: false })] })

    mockGetChecksForCommit.mockResolvedValueOnce({
      checks_passed: true,
      checks: [{ name: 'build', status: 'completed', conclusion: 'success' }],
      rawSnapshot: { schemaVersion: 1, checkRuns: [] },
      matchedSha: 'a'.repeat(40),
      isDefinitive: true,
    })

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(result.skipped).toBe(0)
    expect(mockGetChecksForCommit).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), undefined, null)
    expect(mockSaveCommitSnapshot).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), 'checks', {
      schemaVersion: 1,
      checkRuns: [],
    })
    expect(mockUpdateDeploymentCommitChecks).toHaveBeenCalledWith(
      1,
      {
        checked_sha: 'a'.repeat(40),
        checks_passed: true,
        checks: [{ name: 'build', status: 'completed', conclusion: 'success' }],
      },
      true,
    )
  })

  it('marks the checks-fetch attempt as completed even when GitHub confirms zero check runs, so the backfill converges', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ audit_start_year: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: false })] })

    mockGetChecksForCommit.mockResolvedValueOnce(null)

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(mockUpdateDeploymentCommitChecks).toHaveBeenCalledWith(1, undefined, true)
  })

  it('does not mark the attempt as completed when the checks fetch throws, so the next run retries', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ audit_start_year: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: false })] })

    mockGetChecksForCommit.mockRejectedValueOnce(new Error('GitHub API unavailable'))

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(mockUpdateDeploymentCommitChecks).toHaveBeenCalledWith(1, undefined, false)
  })
})
