import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPoolQuery,
  mockFetchVerificationData,
  mockUpdateDeploymentCommitChecks,
  mockBackfillWorkflowTriggerConfig,
  mockRefreshCommitChecksOnly,
  mockFetchWorkflowRunSnapshotIfMissing,
  mockParseWorkflowRunUrl,
  mockGetRepositoryIdentityById,
} = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockFetchVerificationData: vi.fn(),
  mockUpdateDeploymentCommitChecks: vi.fn(),
  mockBackfillWorkflowTriggerConfig: vi.fn(),
  mockRefreshCommitChecksOnly: vi.fn(),
  mockFetchWorkflowRunSnapshotIfMissing: vi.fn(),
  mockParseWorkflowRunUrl: vi.fn(),
  mockGetRepositoryIdentityById: vi.fn(),
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
  refreshCommitChecksOnly: mockRefreshCommitChecksOnly,
}))

vi.mock('~/lib/verification/fetch-data/pr-data.server', () => ({
  refreshDisplayData: vi.fn(),
}))

vi.mock('~/lib/verification/fetch-data/workflow-triggers.server', () => ({
  backfillWorkflowTriggerConfig: mockBackfillWorkflowTriggerConfig,
}))

vi.mock('~/lib/github/git.server', () => ({
  fetchWorkflowRunSnapshotIfMissing: mockFetchWorkflowRunSnapshotIfMissing,
  getRepositoryIdentityById: mockGetRepositoryIdentityById,
  parseWorkflowRunUrl: mockParseWorkflowRunUrl,
}))

import {
  fetchVerificationDataForAllDeployments,
  fetchVerificationDataForRepository,
} from '~/lib/verification/fetch-data/bulk-fetch.server'

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
    matched_github_repo_id: '987654321',
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
    mockBackfillWorkflowTriggerConfig.mockReset().mockResolvedValue(false)
    mockRefreshCommitChecksOnly.mockReset().mockResolvedValue({})
    mockFetchWorkflowRunSnapshotIfMissing.mockReset()
    mockGetRepositoryIdentityById.mockReset().mockResolvedValue({
      id: 987654321,
      owner: 'navikt',
      name: 'current-name',
      defaultBranch: 'main',
    })
    mockParseWorkflowRunUrl.mockReset()
    mockParseWorkflowRunUrl.mockImplementation((url: string | null, owner: string, repo: string) => {
      const match = url?.match(/^https:\/\/github[.]com\/([^/]+)\/([^/]+)\/actions\/runs\/([0-9]+)$/i)
      if (!match || match[1].toLowerCase() !== owner.toLowerCase() || match[2].toLowerCase() !== repo.toLowerCase()) {
        return null
      }
      return { owner: match[1], repo: match[2], runId: Number(match[3]) }
    })
    mockPoolQuery.mockResolvedValue({ rows: [] })
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

    expect(mockPoolQuery).toHaveBeenCalledTimes(2)
    const [query, params] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('application_repositories')
    expect(query).toContain("ar.status IN ('active', 'historical')")
    expect(query).toContain('r.id = $1')
    expect(query).toContain(
      "JOIN monitored_applications ma\n        ON d.monitored_app_id = ma.id\n        AND (d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)",
    )
    expect(query).not.toContain("WHERE (d.deployment_source != 'nais_apply'")
    expect(params).toEqual([42])
  })

  it('partitions the prev-commit-sha window by repository only, with a deterministic id tie-breaker', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await fetchVerificationDataForRepository(42)

    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain("CASE WHEN d.deployment_source = 'nais_apply' THEN r.github_owner")
    expect(query).toContain('PARTITION BY')
    expect(query).not.toContain('PARTITION BY d.monitored_app_id')
    expect(query).toContain('ORDER BY d.created_at ASC, d.id ASC')
  })

  it('uses the immutable repository name for Apply history and excludes unlinked Apply rows', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        deploymentRow({
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'current-name',
          matched_repository_id: 42,
          default_branch: 'release',
        }),
      ],
    })

    await fetchVerificationDataForAllDeployments(10)

    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain("CASE WHEN d.deployment_source = 'nais_apply' THEN r.github_repo_name")
    expect(query).toContain('(d.repository_id IS NOT NULL AND r.id IS NOT NULL)')
    expect(query).toContain('PARTITION BY')
    expect(mockFetchVerificationData).toHaveBeenCalledWith(
      1,
      'a'.repeat(40),
      'navikt/current-name',
      'prod-gcp',
      'release',
      10,
      { forceRefresh: false },
      undefined,
      42,
      undefined,
    )
  })

  it('refreshes Apply checks using the current repository ID name when cached snapshots exist', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        deploymentRow({
          deployment_source: 'nais_apply',
          claim_github_owner: 'navikt',
          claim_github_repo_name: 'old-name',
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'old-name',
          trigger_url: 'https://github.com/navikt/old-name/actions/runs/12345',
          matched_repository_id: 42,
          matched_github_repo_id: '987654321',
          has_pr_snapshot: true,
          has_compare_snapshot: true,
          has_checks_data: false,
        }),
      ],
    })

    await fetchVerificationDataForAllDeployments(10)

    expect(mockGetRepositoryIdentityById).toHaveBeenCalledWith(987654321)
    expect(mockRefreshCommitChecksOnly).toHaveBeenCalledWith(
      1,
      'navikt',
      'current-name',
      'a'.repeat(40),
      undefined,
      'https://github.com/navikt/current-name/actions/runs/12345',
      null,
      undefined,
      '987654321',
    )
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
    expect(call[8]).toBe(42)
    expect(call[9]).toEqual({ workflowTriggerConfig: null, branchName: null })
  })

  it('fetches a missing workflow-run snapshot once for duplicate runs across deployments', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          deployment_id: 1,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'nda',
          github_owner: 'navikt',
          github_repo_name: 'nda',
          trigger_url: 'https://github.com/navikt/nda/actions/runs/12345',
          github_repo_id: '987654321',
        },
        {
          deployment_id: 2,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'old-nda-name',
          github_owner: 'navikt',
          github_repo_name: 'nda',
          trigger_url: 'https://github.com/navikt/old-nda-name/actions/runs/12345',
          github_repo_id: '987654321',
        },
      ],
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({ status: 'fetched' })

    const result = await fetchVerificationDataForRepository(42)

    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledOnce()
    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledWith(
      'navikt',
      'nda',
      'https://github.com/navikt/nda/actions/runs/12345',
      '987654321',
    )
    expect(result.workflowRunSnapshotsFetched).toBe(1)
    expect(result.workflowRunSnapshotsAvailable).toBe(1)
  })

  it('fetches Apply workflow-run snapshots using the current repository identity', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          deployment_id: 1,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'old-name',
          deployment_source: 'nais_apply',
          github_owner: 'navikt',
          github_repo_name: 'stale-canonical-name',
          trigger_url: 'https://github.com/navikt/old-name/actions/runs/12345',
          github_repo_id: '987654321',
        },
      ],
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({ status: 'fetched' })

    await fetchVerificationDataForRepository(42)

    expect(mockGetRepositoryIdentityById).toHaveBeenCalledWith(987654321)
    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledWith(
      'navikt',
      'current-name',
      'https://github.com/navikt/current-name/actions/runs/12345',
      '987654321',
    )
  })

  it('accepts the canonical workflow URL for renamed Apply deployments', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          deployment_id: 1,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'old-name',
          deployment_source: 'nais_apply',
          github_owner: 'navikt',
          github_repo_name: 'stale-canonical-name',
          trigger_url: 'https://github.com/navikt/current-name/actions/runs/12345',
          github_repo_id: '987654321',
        },
      ],
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({ status: 'fetched' })

    await fetchVerificationDataForRepository(42)

    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledWith(
      'navikt',
      'current-name',
      'https://github.com/navikt/current-name/actions/runs/12345',
      '987654321',
    )
  })

  it('reuses snapshot workflow-trigger data for deployments sharing a workflow run', async () => {
    const triggerUrl = 'https://github.com/navikt/nda/actions/runs/12345'
    const workflowTriggerConfig = {
      workflowPath: '.github/workflows/deploy.yml',
      triggerEvent: 'push',
      checkSuiteId: 42,
      schemaVersion: 3,
    }
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          deploymentRow({ id: 1, trigger_url: triggerUrl, workflow_trigger_config: null }),
          deploymentRow({ id: 2, trigger_url: triggerUrl, workflow_trigger_config: null }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            deployment_id: 1,
            detected_github_owner: 'navikt',
            detected_github_repo_name: 'nda',
            github_owner: 'navikt',
            github_repo_name: 'nda',
            trigger_url: triggerUrl,
            github_repo_id: '987654321',
          },
        ],
      })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({
      status: 'fetched',
      workflowRunResolution: { workflowTriggerConfig, branchName: 'main' },
    })

    await fetchVerificationDataForRepository(42)

    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledOnce()
    expect(mockBackfillWorkflowTriggerConfig).toHaveBeenCalledTimes(2)
    for (const call of mockBackfillWorkflowTriggerConfig.mock.calls) {
      expect(call[5]).toEqual({ workflowTriggerConfig, branchName: 'main' })
    }
  })

  it('reuses workflow-run data for both commit-check and full verification paths', async () => {
    const triggerUrl = 'https://github.com/navikt/nda/actions/runs/12345'
    const workflowRunResolution = {
      workflowTriggerConfig: {
        workflowPath: '.github/workflows/deploy.yml',
        triggerEvent: 'push',
        checkSuiteId: 42,
        schemaVersion: 3,
      },
      branchName: 'release',
    }
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          deploymentRow({
            id: 1,
            trigger_url: triggerUrl,
            workflow_trigger_config: null,
            has_pr_snapshot: true,
            has_compare_snapshot: true,
          }),
          deploymentRow({
            id: 2,
            trigger_url: triggerUrl,
            workflow_trigger_config: null,
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            deployment_id: 1,
            detected_github_owner: 'navikt',
            detected_github_repo_name: 'nda',
            github_owner: 'navikt',
            github_repo_name: 'nda',
            trigger_url: triggerUrl,
            github_repo_id: '987654321',
          },
        ],
      })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({
      status: 'fetched',
      workflowRunResolution,
    })

    await fetchVerificationDataForRepository(42)

    expect(mockRefreshCommitChecksOnly.mock.calls[0]?.[7]).toEqual(workflowRunResolution)
    expect(mockFetchVerificationData.mock.calls[0]?.[9]).toEqual(workflowRunResolution)
    expect(mockFetchWorkflowRunSnapshotIfMissing).toHaveBeenCalledOnce()
  })

  it('stops deployment processing after the snapshot phase detects a secondary rate limit', async () => {
    const triggerUrl = 'https://github.com/navikt/nda/actions/runs/12345'
    mockPoolQuery.mockResolvedValueOnce({ rows: [deploymentRow({ trigger_url: triggerUrl })] }).mockResolvedValueOnce({
      rows: [
        {
          deployment_id: 1,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'nda',
          github_owner: 'navikt',
          github_repo_name: 'nda',
          trigger_url: triggerUrl,
          github_repo_id: '987654321',
        },
      ],
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({ status: 'rate_limited', remaining: 900 })

    const result = await fetchVerificationDataForRepository(42)

    expect(result.rateLimited).toBe(true)
    expect(result.processed).toBe(0)
    expect(mockFetchVerificationData).not.toHaveBeenCalled()
  })

  it('fetches workflow-run snapshots for valid URLs even when the deployment has no usable commit SHA', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          deployment_id: 3,
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'nda',
          github_owner: 'navikt',
          github_repo_name: 'nda',
          trigger_url: 'https://github.com/navikt/nda/actions/runs/12345',
          github_repo_id: '987654321',
        },
      ],
    })
    mockFetchWorkflowRunSnapshotIfMissing.mockResolvedValueOnce({ status: 'not_found' })

    const result = await fetchVerificationDataForRepository(42)

    expect(result.workflowRunSnapshotsNotFound).toBe(1)
    expect(result.workflowRunSnapshotErrors).toBe(0)
    expect(result.total).toBe(0)
  })

  it('uses the established immutable repository deployment scope for both fetch queries', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    await fetchVerificationDataForRepository(42)

    const verificationQuery = mockPoolQuery.mock.calls[0]?.[0] as string
    const snapshotsQuery = mockPoolQuery.mock.calls[1]?.[0] as string
    expect(verificationQuery).toContain('d.repository_id = $1')
    expect(verificationQuery).toContain('other.github_owner = d.detected_github_owner')
    expect(snapshotsQuery).toContain('d.repository_id = $1')
    expect(snapshotsQuery).toContain('other.github_owner = d.detected_github_owner')
    expect(snapshotsQuery).toContain('r.github_repo_id')
    expect(snapshotsQuery).not.toContain('d.commit_sha IS NOT NULL')
  })
})
