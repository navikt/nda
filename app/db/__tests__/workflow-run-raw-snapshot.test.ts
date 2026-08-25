import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import {
  getLatestWorkflowRunRawSnapshot,
  saveWorkflowRunRawSnapshot,
} from '~/db/github-data/workflow-run-raw-snapshots.server'

const mockPoolQuery = pool.query as Mock

const rawWorkflowRun = { id: 555, path: '.github/workflows/deploy.yml', event: 'push', check_suite_id: 42 }

describe('saveWorkflowRunRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw workflow run response into github_workflow_runs_raw_snapshots', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveWorkflowRunRawSnapshot('navikt', 'nda', 999, 555, rawWorkflowRun, apiVersion)

    expect(id).toBe(7)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_workflow_runs_raw_snapshots'), [
      999,
      'navikt',
      'nda',
      555,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawWorkflowRun),
    ])
  })
})

describe('getLatestWorkflowRunRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no raw snapshot exists for the run', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getLatestWorkflowRunRawSnapshot('navikt', 'nda', 555)

    expect(result).toBeNull()
  })

  it('returns the latest raw snapshot for the given run id', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 7,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          run_id: 555,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: rawWorkflowRun,
        },
      ],
    })

    const result = await getLatestWorkflowRunRawSnapshot('navikt', 'nda', 555)

    expect(result).toEqual({
      id: 7,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      runId: 555,
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: rawWorkflowRun,
    })
  })
})
