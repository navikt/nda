import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPoolQuery,
  mockFetchVerificationData,
  mockUpdateDeploymentCommitChecks,
  mockFetchWorkflowRunSnapshotIfMissing,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockFetchVerificationData: vi.fn(),
  mockUpdateDeploymentCommitChecks: vi.fn(),
  mockFetchWorkflowRunSnapshotIfMissing: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
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

vi.mock('~/lib/verification/fetch-data.server', () => ({
  fetchVerificationData: mockFetchVerificationData,
  getAppSettings: vi.fn().mockResolvedValue({ auditStartYear: null }),
}))

vi.mock('~/lib/verification/store-data.server', () => ({
  updateDeploymentCommitChecks: mockUpdateDeploymentCommitChecks,
}))

vi.mock('~/lib/verification/fetch-data/commit-checks.server', () => ({
  refreshCommitChecksOnly: vi.fn(),
}))

vi.mock('~/lib/verification/fetch-data/pr-data.server', () => ({
  refreshDisplayData: vi.fn(),
}))

vi.mock('~/lib/verification/fetch-data/workflow-triggers.server', () => ({
  backfillWorkflowTriggerConfig: vi.fn().mockResolvedValue(false),
}))

vi.mock('~/lib/github/git.server', () => ({
  fetchWorkflowRunSnapshotIfMissing: mockFetchWorkflowRunSnapshotIfMissing,
}))

import { fetchVerificationDataForRepository } from '~/lib/verification/fetch-data/bulk-fetch.server'

function deploymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    commit_sha: 'a'.repeat(40),
    detected_github_owner: 'navikt',
    detected_github_repo_name: 'nda',
    environment_name: 'prod-gcp',
    trigger_url: null,
    workflow_trigger_config: null,
    commit_checks_data: null,
    monitored_app_id: 10,
    default_branch: 'main',
    matched_repository_id: 42,
    created_at: new Date(),
    prev_commit_sha: null,
    has_pr_snapshot: false,
    has_compare_snapshot: false,
    has_checks_data: false,
    ...overrides,
  }
}

describe('fetchVerificationDataForRepository', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
    mockFetchVerificationData.mockReset()
    mockUpdateDeploymentCommitChecks.mockReset()
    mockFetchWorkflowRunSnapshotIfMissing.mockReset()
    mockFetchVerificationData.mockResolvedValue({
      commitChecks: null,
      commitChecksAttempted: false,
      dataFreshness: { prDerivedFromRaw: false, compareDerivedFromRaw: false },
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValue({ status: 'already_present' })
  })

  it('queries deployments matched via application_repositories including active and historical links', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await fetchVerificationDataForRepository(42)

    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
    const [query, params] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('application_repositories')
    expect(query).toContain("ar.status IN ('active', 'historical')")
    expect(query).toContain('r.id = $1')
    expect(params).toEqual([42])
  })

  it('partitions the prev-commit-sha window by repository only, with a deterministic id tie-breaker', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await fetchVerificationDataForRepository(42)

    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('PARTITION BY d.detected_github_owner, d.detected_github_repo_name')
    expect(query).not.toContain('PARTITION BY d.monitored_app_id')
    expect(query).toContain('ORDER BY d.created_at ASC, d.id ASC')
  })

  it('processes deployments from multiple monitored apps linked to the same repository, using each row own app id', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [deploymentRow({ id: 1, monitored_app_id: 10 }), deploymentRow({ id: 2, monitored_app_id: 20 })],
    })

    const result = await fetchVerificationDataForRepository(42)

    expect(result.fetched).toBe(2)
    expect(mockFetchVerificationData).toHaveBeenCalledTimes(2)
    expect(mockFetchVerificationData.mock.calls[0][5]).toBe(10)
    expect(mockFetchVerificationData.mock.calls[1][5]).toBe(20)
  })

  it('passes the matched repository id through to fetchVerificationData for settings resolution', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [deploymentRow({ matched_repository_id: 42 })] })

    await fetchVerificationDataForRepository(42)

    expect(mockFetchVerificationData).toHaveBeenCalledTimes(1)
    const call = mockFetchVerificationData.mock.calls[0]
    expect(call[call.length - 1]).toBe(42)
  })

  it('fetches a missing workflow-run snapshot once for duplicate runs across deployments', async () => {
    const sharedTriggerUrl = 'https://github.com/navikt/nda/actions/runs/12345'
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        deploymentRow({
          id: 1,
          trigger_url: sharedTriggerUrl,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'nda',
        }),
        deploymentRow({
          id: 2,
          monitored_app_id: 20,
          trigger_url: sharedTriggerUrl,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'nda',
        }),
      ],
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({ status: 'fetched' })

    const result = await fetchVerificationDataForRepository(42)

    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledOnce()
    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledWith('navikt', 'nda', sharedTriggerUrl, 42)
    expect(result.workflowRunSnapshotsFetched).toBe(1)
    expect(result.workflowRunSnapshotsAvailable).toBe(1)
  })

  it('tracks GitHub runs that are no longer available without failing other repository data fetches', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        deploymentRow({
          trigger_url: 'https://github.com/navikt/nda/actions/runs/12345',
        }),
      ],
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({ status: 'not_found' })

    const result = await fetchVerificationDataForRepository(42)

    expect(result.workflowRunSnapshotsNotFound).toBe(1)
    expect(result.workflowRunSnapshotErrors).toBe(0)
    expect(result.fetched).toBe(1)
  })
})
