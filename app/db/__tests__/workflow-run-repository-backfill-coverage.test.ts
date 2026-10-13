import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('../connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

import {
  getWorkflowRunBackfillCoverageTeams,
  getWorkflowRunRepositoryBackfillCoverage,
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
    expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual(['team-a'])
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
})
