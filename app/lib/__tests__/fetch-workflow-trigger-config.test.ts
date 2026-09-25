import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockPoolQuery, mockResolveWorkflowRunDetails } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockResolveWorkflowRunDetails: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/sync-jobs.server', () => ({
  heartbeatSyncJob: vi.fn(),
  isSyncJobCancelled: vi.fn(),
  updateSyncJobProgress: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  resolveWorkflowRunDetails: mockResolveWorkflowRunDetails,
  WORKFLOW_TRIGGER_CONFIG_SCHEMA_VERSION: 3,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  backfillWorkflowTriggerConfig,
  fetchWorkflowTriggerConfig,
} from '~/lib/verification/fetch-data/workflow-triggers.server'

const cachedConfig = {
  workflowPath: '.github/workflows/deploy.yml',
  triggerEvent: 'push',
  checkSuiteId: 42,
  schemaVersion: 3,
}

describe('fetchWorkflowTriggerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns immediately when triggerUrl is missing', async () => {
    const result = await fetchWorkflowTriggerConfig(1, 'navikt', 'repo', null)

    expect(result).toEqual({ config: undefined, repositoryId: null, headBranch: null, liveFetchPerformed: false })
    expect(mockPoolQuery).not.toHaveBeenCalled()
    expect(mockResolveWorkflowRunDetails).not.toHaveBeenCalled()
  })

  it('reuses the cached config without a live call when github_repo_id is already resolved', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ workflow_trigger_config: cachedConfig, github_repo_id: '123' }],
    })

    const result = await fetchWorkflowTriggerConfig(
      1,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
    )

    expect(result).toEqual({ config: cachedConfig, repositoryId: 123, headBranch: null, liveFetchPerformed: false })
    expect(mockResolveWorkflowRunDetails).not.toHaveBeenCalled()
  })

  it('makes a live lookup when the config is cached but github_repo_id is still NULL', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ workflow_trigger_config: cachedConfig, github_repo_id: null }],
    })
    mockResolveWorkflowRunDetails.mockResolvedValueOnce({
      workflowTrigger: cachedConfig,
      repositoryId: 456,
      headBranch: 'feature/x',
    })

    const result = await fetchWorkflowTriggerConfig(
      1,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
    )

    expect(mockResolveWorkflowRunDetails).toHaveBeenCalledWith(
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
    )
    expect(result).toEqual({
      config: cachedConfig,
      repositoryId: 456,
      headBranch: 'feature/x',
      liveFetchPerformed: true,
    })
  })

  it('keeps serving the cached config when a live lookup for the repo id returns no trigger (e.g. run 404s)', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ workflow_trigger_config: cachedConfig, github_repo_id: null }],
    })
    mockResolveWorkflowRunDetails.mockResolvedValueOnce({
      workflowTrigger: null,
      repositoryId: null,
      headBranch: null,
    })

    const result = await fetchWorkflowTriggerConfig(
      1,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
    )

    expect(result).toEqual({
      config: cachedConfig,
      repositoryId: null,
      headBranch: null,
      liveFetchPerformed: true,
    })
  })

  it('makes a live lookup when there is no cached config at all', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ workflow_trigger_config: null, github_repo_id: null }] })
    mockResolveWorkflowRunDetails.mockResolvedValueOnce({
      workflowTrigger: cachedConfig,
      repositoryId: 789,
      headBranch: 'main',
    })

    const result = await fetchWorkflowTriggerConfig(
      1,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
    )

    expect(mockResolveWorkflowRunDetails).toHaveBeenCalledTimes(1)
    expect(result.repositoryId).toBe(789)
    expect(result.liveFetchPerformed).toBe(true)
  })

  it('forces a live lookup when forceRefresh is set, even with a fully-resolved cache', async () => {
    mockResolveWorkflowRunDetails.mockResolvedValueOnce({
      workflowTrigger: cachedConfig,
      repositoryId: 999,
      headBranch: 'main',
    })

    const result = await fetchWorkflowTriggerConfig(
      1,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
      { forceRefresh: true },
    )

    expect(mockPoolQuery).not.toHaveBeenCalled()
    expect(result.liveFetchPerformed).toBe(true)
  })
})

describe('backfillWorkflowTriggerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists the resolved repository id alongside the workflow trigger config', async () => {
    mockResolveWorkflowRunDetails.mockResolvedValueOnce({
      workflowTrigger: cachedConfig,
      repositoryId: 321,
      headBranch: 'main',
    })
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const fetched = await backfillWorkflowTriggerConfig(
      5,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
      null,
    )

    expect(fetched).toBe(true)
    const [query, params] = (mockPoolQuery as Mock).mock.calls[0]
    expect(query).toContain('github_repo_id = COALESCE(deployments.github_repo_id')
    expect(params).toEqual([JSON.stringify(cachedConfig), 5, 321])
  })

  it('does nothing when the current config already has the latest schema version and repo id is known', async () => {
    const fetched = await backfillWorkflowTriggerConfig(
      5,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
      {
        ...cachedConfig,
        schemaVersion: 3,
      },
      123,
    )

    expect(fetched).toBe(false)
    expect(mockResolveWorkflowRunDetails).not.toHaveBeenCalled()
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('re-resolves when the config has the latest schema version but github_repo_id is still NULL', async () => {
    mockResolveWorkflowRunDetails.mockResolvedValue({
      workflowTrigger: cachedConfig,
      repositoryId: 999,
      headBranch: null,
    })
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const fetched = await backfillWorkflowTriggerConfig(
      5,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
      {
        ...cachedConfig,
        schemaVersion: 3,
      },
      null,
    )

    expect(fetched).toBe(true)
    expect(mockResolveWorkflowRunDetails).toHaveBeenCalledWith(
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
    )
  })

  it('persists a resolved repository id even when the trigger config itself could not be reconstructed', async () => {
    mockResolveWorkflowRunDetails.mockResolvedValueOnce({
      workflowTrigger: null,
      repositoryId: 654,
      headBranch: null,
    })
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const fetched = await backfillWorkflowTriggerConfig(
      5,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
      null,
    )

    expect(fetched).toBe(true)
    const [query, params] = (mockPoolQuery as Mock).mock.calls[0]
    expect(query).not.toContain('workflow_trigger_config')
    expect(query).toContain('github_repo_id = COALESCE(deployments.github_repo_id')
    expect(params).toEqual([5, 654])
  })

  it('does nothing when neither the trigger config nor a repository id could be resolved', async () => {
    mockResolveWorkflowRunDetails.mockResolvedValueOnce({
      workflowTrigger: null,
      repositoryId: null,
      headBranch: null,
    })

    const fetched = await backfillWorkflowTriggerConfig(
      5,
      'navikt',
      'repo',
      'https://github.com/navikt/repo/actions/runs/1',
      null,
    )

    expect(fetched).toBe(false)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })
})
