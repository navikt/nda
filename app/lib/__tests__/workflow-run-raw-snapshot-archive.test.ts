import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockGetWorkflowRun = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
    },
    actions: {
      getWorkflowRun: mockGetWorkflowRun,
    },
  }),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import { getWorkflowTriggerConfig } from '~/lib/github/git.server'

const mockPoolQuery = pool.query as Mock

const workflowRunData = {
  id: 555,
  path: '.github/workflows/deploy.yml',
  event: 'push',
  check_suite_id: 42,
  head_branch: 'main',
  status: 'completed',
}

describe('getWorkflowTriggerConfig', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockGetWorkflowRun.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw workflow run response after a fresh fetch', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockGetWorkflowRun.mockResolvedValueOnce({
      data: workflowRunData,
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await getWorkflowTriggerConfig(
      'navikt',
      'archive-repo',
      'https://github.com/navikt/archive-repo/actions/runs/555',
    )

    expect(result).toEqual({
      workflowPath: '.github/workflows/deploy.yml',
      triggerEvent: 'push',
      checkSuiteId: 42,
      schemaVersion: 3,
    })

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_workflow_runs_raw_snapshots'), [
      999,
      'navikt',
      'archive-repo',
      555,
      '2022-11-28',
      null,
      null,
      JSON.stringify(workflowRunData),
    ])
  })

  it('does not archive and still returns the trigger config when the repository id cannot be resolved', async () => {
    mockReposGet.mockRejectedValueOnce(new Error('boom'))
    mockGetWorkflowRun.mockResolvedValueOnce({
      data: workflowRunData,
      headers: {},
    })

    const result = await getWorkflowTriggerConfig(
      'navikt',
      'unresolvable-repo',
      'https://github.com/navikt/unresolvable-repo/actions/runs/555',
    )

    expect(result).toEqual({
      workflowPath: '.github/workflows/deploy.yml',
      triggerEvent: 'push',
      checkSuiteId: 42,
      schemaVersion: 3,
    })
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('still returns the trigger config even if archiving the raw snapshot fails', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 999 } })
    mockGetWorkflowRun.mockResolvedValueOnce({
      data: workflowRunData,
      headers: {},
    })
    mockPoolQuery.mockRejectedValueOnce(new Error('db down'))

    const result = await getWorkflowTriggerConfig(
      'navikt',
      'db-failure-repo',
      'https://github.com/navikt/db-failure-repo/actions/runs/555',
    )

    expect(result).toEqual({
      workflowPath: '.github/workflows/deploy.yml',
      triggerEvent: 'push',
      checkSuiteId: 42,
      schemaVersion: 3,
    })
  })
})
