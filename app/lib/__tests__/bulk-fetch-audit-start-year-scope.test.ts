import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery, mockFetchVerificationData, mockGetAppSettings, mockUpdateDeploymentCommitChecks } = vi.hoisted(
  () => ({
    mockPoolQuery: vi.fn(),
    mockFetchVerificationData: vi.fn(),
    mockGetAppSettings: vi.fn(),
    mockUpdateDeploymentCommitChecks: vi.fn(),
  }),
)

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
  getAppSettings: mockGetAppSettings,
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

import { fetchVerificationDataForAllDeployments } from '~/lib/verification/fetch-data/bulk-fetch.server'

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
    default_branch: 'main',
    created_at: new Date('2020-01-01T00:00:00Z'),
    prev_commit_sha: null,
    has_pr_snapshot: false,
    has_compare_snapshot: false,
    has_checks_data: false,
    ...overrides,
  }
}

describe('fetchVerificationDataForAllDeployments audit-year scope', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
    mockFetchVerificationData.mockReset()
    mockGetAppSettings.mockReset()
    mockUpdateDeploymentCommitChecks.mockReset()
  })

  it('fetches deployments regardless of auditStartYear, without an audit-year query parameter', async () => {
    mockGetAppSettings.mockResolvedValueOnce({ auditStartYear: 2026 })
    mockPoolQuery.mockResolvedValueOnce({
      rows: [deploymentRow({ created_at: new Date('2020-01-01T00:00:00Z') })],
    })
    mockFetchVerificationData.mockResolvedValueOnce({
      commitChecks: null,
      commitChecksAttempted: false,
      dataFreshness: { prDerivedFromRaw: false, compareDerivedFromRaw: false },
    })

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.total).toBe(1)
    expect(result.fetched).toBe(1)

    const [query, params] = mockPoolQuery.mock.calls[0]
    expect(query).not.toContain('created_at >=')
    expect(params).toEqual([1])
  })
})
