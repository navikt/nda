import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClientQuery, mockClient, mockPoolQuery } = vi.hoisted(() => {
  const mockClientQuery = vi.fn()
  return {
    mockClientQuery,
    mockClient: { query: mockClientQuery, release: vi.fn() },
    mockPoolQuery: vi.fn(),
  }
})

vi.mock('~/db/connection.server', () => ({
  pool: { connect: vi.fn(async () => mockClient), query: mockPoolQuery },
}))

import {
  getLatestWorkflowRunRawSnapshot,
  saveWorkflowRunRawSnapshot,
} from '~/db/github-data/workflow-run-raw-snapshots.server'

const rawWorkflowRun = { id: 555, path: '.github/workflows/deploy.yml', event: 'push', check_suite_id: 42 }

describe('saveWorkflowRunRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw workflow run response into github_workflow_runs_raw_snapshots', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const id = await saveWorkflowRunRawSnapshot('navikt', 'nda', 999, 555, rawWorkflowRun, apiVersion)

    expect(id).toBe(7)
    const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('github_workflow_runs_raw_snapshots'),
    )
    expect(insertCall?.[1]).toEqual([
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

  it('acquires an advisory lock before the dedup check against the latest snapshot for the run id', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 7 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    await saveWorkflowRunRawSnapshot('navikt', 'nda', 999, 555, rawWorkflowRun, apiVersion)

    const calls = mockClientQuery.mock.calls
    expect(calls[0]).toEqual(['BEGIN'])
    expect(calls[1][0]).toContain('pg_advisory_xact_lock')
    expect(calls[1][1]).toEqual([expect.any(Number), '999:555'])
    const [query] = calls[2]
    expect(query).toContain('last_snapshot')
    expect(query).toContain('NOT EXISTS')
    expect(calls[3]).toEqual(['COMMIT'])
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
