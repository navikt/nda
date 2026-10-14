import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('../connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

import {
  backfillEligibleWorkflowRunRepositoryIds,
  getWorkflowRunBackfillCoverageTeams,
  getWorkflowRunBackfillPreviewRepository,
  getWorkflowRunRepositoryBackfillCoverage,
  getWorkflowRunRepositoryBackfillPreview,
} from '../workflow-run-repository-backfill-coverage.server'

describe('getWorkflowRunRepositoryBackfillCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps aggregated database rows to the report model', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          repository_id: 216,
          github_owner: 'navikt',
          github_repo_name: 'pensjon-alde',
          total_legacy_deployments: 12,
          eligible: 5,
          no_trigger_url: 1,
          invalid_trigger_url: 1,
          trigger_url_mismatch: 1,
          missing_snapshot: 1,
          repository_mismatch: 1,
          sha_mismatch: 1,
          unsupported_event: 1,
          head_repository_mismatch: 0,
          backfill_job_id: null,
          backfill_job_status: null,
          backfill_job_result: null,
          backfill_job_error: null,
        },
      ],
    })

    await expect(getWorkflowRunRepositoryBackfillCoverage('team-a')).resolves.toEqual([
      {
        repositoryId: 216,
        githubOwner: 'navikt',
        githubRepoName: 'pensjon-alde',
        totalLegacyDeployments: 12,
        eligible: 5,
        noTriggerUrl: 1,
        invalidTriggerUrl: 1,
        triggerUrlMismatch: 1,
        missingSnapshot: 1,
        repositoryMismatch: 1,
        shaMismatch: 1,
        unsupportedEvent: 1,
        headRepositoryMismatch: 0,
        backfillJob: null,
      },
    ])
    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('FROM monitored_applications ma')
    expect(query).toContain('JOIN application_repositories ar')
    expect(query).toContain('JOIN deployments d')
    expect(query).toContain('WHERE ma.team_slug = $1')
    expect(query).toContain('d.repository_id IS NULL')
    expect(query).toContain('r.github_repo_id,')
    expect(query).toContain('snapshot.github_repo_id = parsed_workflow_runs.github_repo_id')
    expect(query).toContain('snapshot.run_id = parsed_workflow_runs.workflow_run_id')
    expect(query).not.toContain('snapshot.github_repo_id::text')
    expect(query).toContain("workflow_run_data->'repository'->>'id' IS DISTINCT FROM github_repo_id::text")
    expect(query).toContain("workflow_run_data->'head_repository'->>'id' IS DISTINCT FROM github_repo_id::text")
    expect(query).toContain("job_type = 'backfill_github_repo_ids'")
    expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual(['team-a'])
  })

  it('keeps a completed repository visible after its legacy deployments have been backfilled', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          repository_id: 216,
          github_owner: 'navikt',
          github_repo_name: 'pensjon-alde',
          total_legacy_deployments: 0,
          eligible: 0,
          no_trigger_url: 0,
          invalid_trigger_url: 0,
          trigger_url_mismatch: 0,
          missing_snapshot: 0,
          repository_mismatch: 0,
          sha_mismatch: 0,
          unsupported_event: 0,
          head_repository_mismatch: 0,
          backfill_job_id: 91,
          backfill_job_status: 'completed',
          backfill_job_result: { updated: 183 },
          backfill_job_error: null,
        },
      ],
    })

    await expect(getWorkflowRunRepositoryBackfillCoverage('team-a')).resolves.toEqual([
      {
        repositoryId: 216,
        githubOwner: 'navikt',
        githubRepoName: 'pensjon-alde',
        totalLegacyDeployments: 0,
        eligible: 0,
        noTriggerUrl: 0,
        invalidTriggerUrl: 0,
        triggerUrlMismatch: 0,
        missingSnapshot: 0,
        repositoryMismatch: 0,
        shaMismatch: 0,
        unsupportedEvent: 0,
        headRepositoryMismatch: 0,
        backfillJob: {
          id: 91,
          status: 'completed',
          result: { updated: 183 },
          error: null,
        },
      },
    ])
    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('repositories_with_backfill_jobs')
    expect(query).toContain("sj.job_type = 'backfill_github_repo_ids'")
  })

  it('returns a lightweight sorted list of monitored application teams', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ team_slug: 'team-a' }, { team_slug: 'team-b' }],
    })

    await expect(getWorkflowRunBackfillCoverageTeams()).resolves.toEqual(['team-a', 'team-b'])
    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('SELECT DISTINCT team_slug')
    expect(query).toContain('FROM monitored_applications')
    expect(query).toContain('ORDER BY team_slug')
  })

  it('loads a repository-wide preview with one row per deployment and the shared classification', async () => {
    const createdAt = new Date('2026-10-13T12:00:00.000Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          deployment_id: 101,
          team_slug: 'pensjondeployer',
          app_name: 'alde',
          environment_name: 'prod-gcp',
          created_at: createdAt,
          commit_sha: 'a'.repeat(40),
          workflow_run_id: '123',
          classification: 'eligible',
        },
      ],
    })

    await expect(getWorkflowRunRepositoryBackfillPreview(216)).resolves.toEqual([
      {
        deploymentId: 101,
        teamSlug: 'pensjondeployer',
        appName: 'alde',
        environmentName: 'prod-gcp',
        createdAt,
        commitSha: 'a'.repeat(40),
        workflowRunId: '123',
        classification: 'eligible',
      },
    ])

    const [query, parameters] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('WHERE r.id = $1')
    expect(query).toContain('d.repository_id IS NULL')
    expect(query).toContain('JOIN application_repositories ar')
    expect(query).toContain('d.team_slug,')
    expect(query).toContain('d.app_name,')
    expect(query).toContain('d.environment_name,')
    expect(query).toContain('snapshot.github_repo_id = parsed_workflow_runs.github_repo_id')
    expect(query).toContain('ORDER BY created_at DESC, deployment_id DESC')
    expect(query).not.toContain('ma.team_slug =')
    expect(parameters).toEqual([216])
  })

  it('looks up preview metadata by registered repository ID', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{ repository_id: 216, github_owner: 'navikt', github_repo_name: 'pensjon-alde' }],
    })

    await expect(getWorkflowRunBackfillPreviewRepository(216)).resolves.toEqual({
      repositoryId: 216,
      githubOwner: 'navikt',
      githubRepoName: 'pensjon-alde',
    })
    expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual([216])
  })

  it('rechecks strict snapshot eligibility while filling only missing repository IDs', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ updated: 2 }] })

    await expect(backfillEligibleWorkflowRunRepositoryIds(216)).resolves.toBe(2)

    const [query, parameters] = mockPoolQuery.mock.calls[0]
    expect(query).toContain("workflow_run_data->'repository'->>'id' IS DISTINCT FROM github_repo_id::text")
    expect(query).toContain("workflow_run_data->'head_repository'->>'id' IS DISTINCT FROM github_repo_id::text")
    expect(query).toContain("workflow_run_data->>'event' IS DISTINCT FROM 'push'")
    expect(query).toContain("lower(workflow_run_data->>'head_sha') IS DISTINCT FROM lower(commit_sha)")
    expect(query).toContain("c.classification = 'eligible'")
    expect(query).toContain('d.repository_id IS NULL')
    expect(query).toContain('SET repository_id = $1')
    expect(parameters).toEqual([216])
  })
})
