import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION } from '~/lib/github/git.server'

const {
  mockGetChecksForCommit,
  mockSaveCommitSnapshot,
  mockGetWorkflowTriggerConfig,
  mockGetRepositoryId,
  mockSaveChecksRawSnapshot,
} = vi.hoisted(() => ({
  mockGetChecksForCommit: vi.fn(),
  mockSaveCommitSnapshot: vi.fn(),
  mockGetWorkflowTriggerConfig: vi.fn(),
  mockGetRepositoryId: vi.fn(),
  mockSaveChecksRawSnapshot: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp: vi.fn(),
}))

vi.mock('~/lib/github', async () => {
  const gitServer = await vi.importActual<typeof import('~/lib/github/git.server')>('~/lib/github/git.server')
  return {
    getBranchFromWorkflowRun: vi.fn(),
    getChecksForCommit: mockGetChecksForCommit,
    getCommitsBetween: vi.fn(),
    getDetailedPullRequestInfo: vi.fn(),
    getMutablePrDataFromGitHub: vi.fn(),
    getPullRequestForCommit: vi.fn(),
    getRepositoryId: mockGetRepositoryId,
    getSingleCommitMessage: vi.fn(),
    getWorkflowTriggerConfig: mockGetWorkflowTriggerConfig,
    haveSameCommitTree: vi.fn(),
    isCommitOnBranch: vi.fn(),
    WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION: gitServer.WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION,
  }
})

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getAllLatestPrRawSnapshots: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  getLatestCompareSnapshot: vi.fn(),
  saveChecksRawSnapshot: mockSaveChecksRawSnapshot,
  saveCommitSnapshot: mockSaveCommitSnapshot,
  saveCompareSnapshot: vi.fn(),
  savePrSnapshotsBatch: vi.fn(),
  savePrRawSnapshotsBatch: vi.fn(),
}))

vi.mock('~/db/sync-jobs.server', () => ({
  heartbeatSyncJob: vi.fn(),
  isSyncJobCancelled: vi.fn(),
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
  updateDeploymentCommitChecks: vi.fn(),
}))

import { getAllLatestPrRawSnapshots, getAllLatestPrSnapshots } from '~/db/github-data.server'
import { fetchCommitChecks, refreshCommitChecksOnly } from '~/lib/verification/fetch-data.server'
import { updateDeploymentCommitChecks } from '~/lib/verification/store-data.server'

const mockGetAllLatestPrSnapshots = getAllLatestPrSnapshots as unknown as ReturnType<typeof vi.fn>
const mockGetAllLatestPrRawSnapshots = getAllLatestPrRawSnapshots as unknown as ReturnType<typeof vi.fn>
const mockUpdateDeploymentCommitChecks = updateDeploymentCommitChecks as unknown as ReturnType<typeof vi.fn>

describe('fetchCommitChecks', () => {
  beforeEach(() => {
    mockGetChecksForCommit.mockReset()
    mockSaveCommitSnapshot.mockReset()
    mockGetRepositoryId.mockReset()
    mockGetRepositoryId.mockResolvedValue(123)
    mockSaveChecksRawSnapshot.mockReset()
  })

  it('returns commitChecks undefined and archives the definitive empty result when GitHub reports zero check runs, so COALESCE preserves cached data, but still marks the attempt as completed', async () => {
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

    const result = await fetchCommitChecks('navikt', 'nda', 'a'.repeat(40))

    expect(result).toEqual({ commitChecks: undefined, attempted: true })
    expect(mockSaveCommitSnapshot).not.toHaveBeenCalled()
    expect(mockSaveChecksRawSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      123,
      'a'.repeat(40),
      null,
      true,
      [],
      {
        apiVersion: '2022-11-28',
        apiDeprecatedAt: null,
        apiSunsetAt: null,
      },
      expect.any(Date),
    )
  })

  it('does not archive and returns attempted: false when the repository id cannot be resolved', async () => {
    mockGetRepositoryId.mockResolvedValueOnce(null)
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

    const result = await fetchCommitChecks('navikt', 'nda', 'a'.repeat(40))

    expect(result).toEqual({ commitChecks: undefined, attempted: false })
    expect(mockSaveChecksRawSnapshot).not.toHaveBeenCalled()
    expect(mockSaveCommitSnapshot).not.toHaveBeenCalled()
  })

  it('returns attempted: false when the underlying fetch throws (e.g. 404 for missing access or missing data), so the bulk backfill retries later', async () => {
    mockGetChecksForCommit.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))

    const result = await fetchCommitChecks('navikt', 'nda', 'a'.repeat(40))

    expect(result).toEqual({ commitChecks: undefined, attempted: false })
    expect(mockSaveCommitSnapshot).not.toHaveBeenCalled()
  })

  it('returns the checks and archives the snapshot when check runs are found', async () => {
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

    const result = await fetchCommitChecks('navikt', 'nda', 'a'.repeat(40))

    expect(result).toEqual({
      commitChecks: {
        checked_sha: 'a'.repeat(40),
        checks_passed: true,
        checks: [{ name: 'build', status: 'completed', conclusion: 'success' }],
      },
      attempted: true,
    })
    expect(mockSaveCommitSnapshot).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), 'checks', {
      schemaVersion: 1,
      checkRuns: [],
    })
    expect(mockSaveChecksRawSnapshot).toHaveBeenCalledWith(
      'navikt',
      'nda',
      123,
      'a'.repeat(40),
      null,
      true,
      [],
      {
        apiVersion: '2022-11-28',
        apiDeprecatedAt: null,
        apiSunsetAt: null,
      },
      expect.any(Date),
    )
  })

  it('retries against the fallback SHA and reports the matched SHA when the primary commit has no checks', async () => {
    mockGetChecksForCommit.mockResolvedValueOnce({
      checks_passed: false,
      checks: [{ name: 'build', status: 'completed', conclusion: 'failure' }],
      rawSnapshot: { schemaVersion: 1, checkRuns: [] },
      rawCheckRuns: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      matchedSha: 'b'.repeat(40),
      matchedCheckSuiteId: null,
      isDefinitive: true,
    })

    const result = await fetchCommitChecks('navikt', 'nda', 'a'.repeat(40), 'b'.repeat(40))

    expect(result.commitChecks?.checked_sha).toBe('b'.repeat(40))
    expect(mockGetChecksForCommit).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), 'b'.repeat(40), undefined)
    expect(mockSaveCommitSnapshot).toHaveBeenCalledWith('navikt', 'nda', 'b'.repeat(40), 'checks', {
      schemaVersion: 1,
      checkRuns: [],
    })
  })

  it('returns attempted: false (but still returns the partial data) when a check run is still in progress', async () => {
    mockGetChecksForCommit.mockResolvedValueOnce({
      checks_passed: null,
      checks: [{ name: 'build', status: 'in_progress', conclusion: null }],
      rawSnapshot: { schemaVersion: 1, checkRuns: [] },
      rawCheckRuns: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      matchedSha: 'a'.repeat(40),
      matchedCheckSuiteId: null,
      isDefinitive: false,
    })

    const result = await fetchCommitChecks('navikt', 'nda', 'a'.repeat(40))

    expect(result.attempted).toBe(false)
    expect(result.commitChecks?.checks_passed).toBeNull()
    // The check-run data is still archived even though the result isn't definitive yet.
    expect(mockSaveCommitSnapshot).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), 'checks', {
      schemaVersion: 1,
      checkRuns: [],
    })
  })
})

describe('refreshCommitChecksOnly', () => {
  beforeEach(() => {
    mockGetChecksForCommit.mockReset()
    mockSaveCommitSnapshot.mockReset()
    mockGetAllLatestPrSnapshots.mockReset()
    mockGetAllLatestPrRawSnapshots.mockReset()
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(new Map())
    mockUpdateDeploymentCommitChecks.mockReset()
    mockGetWorkflowTriggerConfig.mockReset()
    mockGetRepositoryId.mockReset()
    mockGetRepositoryId.mockResolvedValue(123)
  })

  it('resolves the PR head SHA fallback, fetches checks, and persists the result', async () => {
    mockGetAllLatestPrSnapshots.mockResolvedValueOnce(new Map([['metadata', { data: { headSha: 'b'.repeat(40) } }]]))
    mockGetChecksForCommit.mockResolvedValueOnce({
      checks_passed: true,
      checks: [{ name: 'build', status: 'completed', conclusion: 'success' }],
      rawSnapshot: { schemaVersion: 1, checkRuns: [] },
      rawCheckRuns: [],
      apiVersion: { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null },
      matchedSha: 'b'.repeat(40),
      matchedCheckSuiteId: null,
      isDefinitive: true,
    })

    const result = await refreshCommitChecksOnly(1, 'navikt', 'nda', 'a'.repeat(40), 42)

    expect(mockGetAllLatestPrSnapshots).toHaveBeenCalledWith('navikt', 'nda', 42)
    expect(mockGetChecksForCommit).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), 'b'.repeat(40), null)
    expect(result.attempted).toBe(true)
    expect(mockUpdateDeploymentCommitChecks).toHaveBeenCalledWith(1, result.commitChecks, true)
  })

  it('skips the PR head SHA fallback lookup when there is no PR number', async () => {
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

    await refreshCommitChecksOnly(1, 'navikt', 'nda', 'a'.repeat(40), null)

    expect(mockGetAllLatestPrSnapshots).not.toHaveBeenCalled()
    expect(mockGetChecksForCommit).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), undefined, null)
  })

  it('reuses a check_suite_id from a valid cached workflow_trigger_config without calling GitHub again', async () => {
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

    await refreshCommitChecksOnly(
      1,
      'navikt',
      'nda',
      'a'.repeat(40),
      null,
      'https://github.com/navikt/nda/actions/runs/1',
      {
        workflowPath: '.github/workflows/deploy.yml',
        triggerEvent: 'push',
        checkSuiteId: 555,
        schemaVersion: WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION,
      },
    )

    expect(mockGetWorkflowTriggerConfig).not.toHaveBeenCalled()
    expect(mockGetChecksForCommit).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), undefined, 555)
  })

  it('resolves the check_suite_id via GitHub when the cached workflow_trigger_config is stale or missing', async () => {
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
    mockGetWorkflowTriggerConfig.mockResolvedValueOnce({
      workflowPath: '.github/workflows/deploy.yml',
      triggerEvent: 'push',
      checkSuiteId: 777,
      schemaVersion: WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION,
    })

    await refreshCommitChecksOnly(
      1,
      'navikt',
      'nda',
      'a'.repeat(40),
      null,
      'https://github.com/navikt/nda/actions/runs/1',
      null,
    )

    expect(mockGetWorkflowTriggerConfig).toHaveBeenCalledWith(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/1',
    )
    expect(mockGetChecksForCommit).toHaveBeenCalledWith('navikt', 'nda', 'a'.repeat(40), undefined, 777)
  })
})
