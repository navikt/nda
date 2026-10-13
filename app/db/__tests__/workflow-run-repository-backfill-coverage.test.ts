import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('../connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

import { getWorkflowRunRepositoryBackfillCoverage } from '../workflow-run-repository-backfill-coverage.server'

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

    await expect(getWorkflowRunRepositoryBackfillCoverage()).resolves.toEqual([
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
    expect(query).toContain('snapshot.github_repo_id = parsed_workflow_runs.github_repo_id')
    expect(query).toContain('snapshot.run_id = parsed_workflow_runs.workflow_run_id')
    expect(query).not.toContain('snapshot.github_repo_id::text')
  })
})
