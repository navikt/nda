import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery, mockFetchVerificationData, mockUpdateDeploymentCommitChecks } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockFetchVerificationData: vi.fn(),
  mockUpdateDeploymentCommitChecks: vi.fn(),
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
    created_at: new Date(),
    prev_commit_sha: null,
    has_pr_snapshot: false,
    has_compare_snapshot: false,
    has_checks_data: false,
    ...overrides,
  }
}

describe('fetchVerificationDataForAllDeployments derivedFromRaw counter', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
    mockFetchVerificationData.mockReset()
    mockUpdateDeploymentCommitChecks.mockReset()
  })

  it('increments derivedFromRaw when PR data is derived from a raw snapshot', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [deploymentRow()] }) // deployments query

    mockFetchVerificationData.mockResolvedValueOnce({
      commitChecks: null,
      commitChecksAttempted: false,
      dataFreshness: { prDerivedFromRaw: true, compareDerivedFromRaw: false },
    })

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(result.derivedFromRaw).toBe(1)
  })

  it('does not increment derivedFromRaw when data is fetched from GitHub', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [deploymentRow()] })

    mockFetchVerificationData.mockResolvedValueOnce({
      commitChecks: null,
      commitChecksAttempted: false,
      dataFreshness: { prDerivedFromRaw: false, compareDerivedFromRaw: false },
    })

    const result = await fetchVerificationDataForAllDeployments(1)

    expect(result.fetched).toBe(1)
    expect(result.derivedFromRaw).toBe(0)
  })
})
