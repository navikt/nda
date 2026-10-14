import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import {
  getLatestWorkflowJobsRawSnapshot,
  saveWorkflowJobsRawSnapshot,
} from '~/db/github-data/workflow-jobs-raw-snapshots.server'

const mockPoolQuery = pool.query as Mock

const rawJobs = [{ id: 555, name: 'deploy', status: 'completed', steps: [] }]
const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }

describe('saveWorkflowJobsRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores raw workflow jobs by run and attempt', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    await expect(saveWorkflowJobsRawSnapshot('navikt', 'nda', 999, 555, 2, rawJobs, apiVersion)).resolves.toBe(7)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_workflow_jobs_raw_snapshots'), [
      999,
      'navikt',
      'nda',
      555,
      2,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      JSON.stringify(rawJobs),
    ])
  })
})

describe('getLatestWorkflowJobsRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses attempt identity including null for all-attempt snapshots', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    await expect(getLatestWorkflowJobsRawSnapshot(999, 555, null)).resolves.toBeNull()
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('attempt_number IS NOT DISTINCT FROM $3::integer'),
      [999, 555, null],
    )
  })

  it('returns the latest snapshot for the requested attempt', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 7,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          run_id: 555,
          attempt_number: 2,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: rawJobs,
        },
      ],
    })

    await expect(getLatestWorkflowJobsRawSnapshot(999, 555, 2)).resolves.toEqual({
      id: 7,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      runId: 555,
      attemptNumber: 2,
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: rawJobs,
    })
  })
})
