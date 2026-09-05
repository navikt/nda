import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPoolQuery,
  mockGetChecksForCommit,
  mockSaveCommitSnapshot,
  mockUpdateDeploymentCommitChecks,
  mockGetAllLatestPrRawSnapshots,
  mockSavePrRawSnapshotsBatch,
  mockGetDisplayDataFromGitHub,
  mockGetRepositoryId,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetChecksForCommit: vi.fn(),
  mockSaveCommitSnapshot: vi.fn(),
  mockUpdateDeploymentCommitChecks: vi.fn(),
  mockGetAllLatestPrRawSnapshots: vi.fn(),
  mockSavePrRawSnapshotsBatch: vi.fn(),
  mockGetDisplayDataFromGitHub: vi.fn(),
  mockGetRepositoryId: vi.fn(),
}))

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
  getDisplayDataFromGitHub: mockGetDisplayDataFromGitHub,
  getMutablePrDataFromGitHub: vi.fn(),
  getPullRequestForCommit: vi.fn(),
  getRepositoryId: mockGetRepositoryId,
  getSingleCommitMessage: vi.fn(),
  getWorkflowTriggerConfig: vi.fn(),
  haveSameCommitTree: vi.fn(),
  isCommitOnBranch: vi.fn(),
  WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION: 1,
}))

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getAllLatestPrRawSnapshots: mockGetAllLatestPrRawSnapshots,
  getLatestCommitSnapshot: vi.fn(),
  getLatestCompareSnapshot: vi.fn(),
  markPrDataUnavailable: vi.fn(),
  saveChecksRawSnapshot: vi.fn(),
  saveCommitSnapshot: mockSaveCommitSnapshot,
  saveCompareSnapshot: vi.fn(),
  savePrSnapshotsBatch: vi.fn(),
  savePrRawSnapshotsBatch: mockSavePrRawSnapshotsBatch,
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

import { fetchVerificationDataForAllDeployments } from '~/lib/verification/fetch-data/bulk-fetch.server'

function effectiveSettingsRow() {
  return {
    monitored_app_id: 1,
    app_audit_start_year: null,
    app_default_branch: 'main',
    app_implicit_approval_mode: null,
    repository_id: null,
    repo_audit_start_year: null,
    repo_implicit_approval_mode: null,
    repo_default_branch: null,
  }
}

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
    mockGetAllLatestPrRawSnapshots.mockReset()
    mockSavePrRawSnapshotsBatch.mockReset()
    mockGetDisplayDataFromGitHub.mockReset()
    mockGetRepositoryId.mockReset()
    mockGetRepositoryId.mockResolvedValue(123)
  })

  it('skips deployments that already have PR/compare data and commit_checks_data', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [effectiveSettingsRow()] }) // effective repository settings lookup
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: true })] }) // deployments query

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.skipped).toBe(1)
    expect(result.fetched).toBe(0)
    expect(mockGetChecksForCommit).not.toHaveBeenCalled()
    expect(mockUpdateDeploymentCommitChecks).not.toHaveBeenCalled()
  })

  it('backfills only commit_checks_data for deployments with PR/compare data but no checks yet', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [effectiveSettingsRow()] })
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: false })] })

    mockGetChecksForCommit.mockResolvedValueOnce({
      checks_passed: true,
      checks: [{ name: 'build', status: 'completed', conclusion: 'success' }],
      rawSnapshot: { schemaVersion: 1, checkRuns: [] },
      rawCheckRuns: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      matchedSha: 'a'.repeat(40),
      matchedCheckSuiteId: null,
      isDefinitive: true,
    })

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.derivedFromRaw).toBe(0)
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
      .mockResolvedValueOnce({ rows: [effectiveSettingsRow()] })
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: false })] })

    mockGetChecksForCommit.mockResolvedValueOnce({
      checks_passed: null,
      checks: [],
      rawSnapshot: { schemaVersion: 1, checkRuns: [] },
      rawCheckRuns: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      matchedSha: 'a'.repeat(40),
      matchedCheckSuiteId: null,
      isDefinitive: true,
    })

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(mockUpdateDeploymentCommitChecks).toHaveBeenCalledWith(1, undefined, true)
  })

  it('does not mark the attempt as completed when the checks fetch throws, so the next run retries', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [effectiveSettingsRow()] })
      .mockResolvedValueOnce({ rows: [baseDeploymentRow({ has_checks_data: false })] })

    mockGetChecksForCommit.mockRejectedValueOnce(new Error('GitHub API unavailable'))

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(mockUpdateDeploymentCommitChecks).toHaveBeenCalledWith(1, undefined, false)
  })

  it('refreshes only PR display data (not reviews/commits) when refreshDisplayData is set for a fully cached deployment', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [effectiveSettingsRow()] }).mockResolvedValueOnce({
      rows: [baseDeploymentRow({ has_checks_data: true, github_pr_number: 42 })],
    })

    const rawPr = {
      base: { ref: 'main', sha: 'base123', repo: { id: 42 } },
      head: { ref: 'feature', sha: 'head123' },
      title: 'Some PR',
      body: null,
      labels: [],
      created_at: '2026-01-01T00:00:00Z',
      merged_at: null,
      merge_commit_sha: null,
      commits: 1,
      changed_files: 1,
      additions: 1,
      deletions: 1,
      comments: 0,
      review_comments: 0,
      draft: false,
      mergeable: null,
      mergeable_state: null,
      rebaseable: null,
      locked: false,
      maintainer_can_modify: false,
      auto_merge: null,
      user: { login: 'dev', avatar_url: '' },
      merged_by: null,
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
      milestone: null,
    }

    mockGetAllLatestPrRawSnapshots.mockResolvedValue(
      new Map([
        ['pr', { githubRepoId: 42, data: rawPr }],
        ['reviews', { data: [] }],
        ['commits', { data: [] }],
      ]),
    )
    mockGetDisplayDataFromGitHub.mockResolvedValueOnce({
      githubRepoId: 42,
      pr: { ...rawPr, title: 'Updated title' },
      issueComments: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
    })
    mockSavePrRawSnapshotsBatch.mockResolvedValueOnce([1, 2])

    const result = await fetchVerificationDataForAllDeployments(1, { refreshDisplayData: true })

    expect(result.fetched).toBe(1)
    expect(result.skipped).toBe(0)
    expect(mockGetDisplayDataFromGitHub).toHaveBeenCalledWith('navikt', 'nda', 42)
    expect(mockGetChecksForCommit).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshotsBatch).toHaveBeenCalledWith(
      'navikt',
      'nda',
      42,
      42,
      { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      [
        { dataType: 'pr', data: expect.objectContaining({ title: 'Updated title' }) },
        { dataType: 'comments', data: [] },
      ],
    )
  })

  it('counts as skipped, not fetched, when the display data refresh fails to find a raw snapshot', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [effectiveSettingsRow()] }).mockResolvedValueOnce({
      rows: [baseDeploymentRow({ has_checks_data: true, github_pr_number: 42 })],
    })

    mockGetAllLatestPrRawSnapshots.mockResolvedValue(new Map())

    const result = await fetchVerificationDataForAllDeployments(1, { refreshDisplayData: true })

    expect(result.fetched).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockGetDisplayDataFromGitHub).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshotsBatch).not.toHaveBeenCalled()
  })
})
