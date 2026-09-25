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
import { resolveWorkflowRunDetails } from '~/lib/github/git.server'

const mockPoolQuery = pool.query as Mock

const workflowRunData = {
  id: 555,
  path: '.github/workflows/deploy.yml',
  event: 'push',
  check_suite_id: 42,
  head_branch: 'main',
  status: 'completed',
  repository: { id: 999 },
}

const workflowRunDataWithoutRepository = {
  id: 555,
  path: '.github/workflows/deploy.yml',
  event: 'push',
  check_suite_id: 42,
  head_branch: 'main',
  status: 'completed',
}

describe('resolveWorkflowRunDetails', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockGetWorkflowRun.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
  })

  it('archives the raw workflow run response using the id extracted from the payload', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      data: workflowRunData,
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const result = await resolveWorkflowRunDetails(
      'navikt',
      'archive-repo',
      'https://github.com/navikt/archive-repo/actions/runs/555',
    )

    expect(result).toEqual({
      headBranch: 'main',
      workflowTrigger: {
        workflowPath: '.github/workflows/deploy.yml',
        triggerEvent: 'push',
        checkSuiteId: 42,
        schemaVersion: 3,
      },
      repositoryId: 999,
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
    // No name-based fallback lookup should ever be attempted: the payload already had the id.
    expect(mockReposGet).not.toHaveBeenCalled()
  })

  it('does not archive and does not fall back to a name-based lookup when the payload lacks repository.id', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      data: workflowRunDataWithoutRepository,
      headers: {},
    })

    const result = await resolveWorkflowRunDetails(
      'navikt',
      'unresolvable-repo',
      'https://github.com/navikt/unresolvable-repo/actions/runs/555',
    )

    expect(result).toEqual({
      headBranch: 'main',
      workflowTrigger: {
        workflowPath: '.github/workflows/deploy.yml',
        triggerEvent: 'push',
        checkSuiteId: 42,
        schemaVersion: 3,
      },
      repositoryId: null,
    })
    expect(mockPoolQuery).not.toHaveBeenCalled()
    // Archiving must never guess the repository by its current owner/name: names can be reused
    // after a rename, which could silently attach an unrelated repository's id.
    expect(mockReposGet).not.toHaveBeenCalled()
  })

  it('still returns the trigger config even if archiving the raw snapshot fails', async () => {
    mockGetWorkflowRun.mockResolvedValueOnce({
      data: workflowRunData,
      headers: {},
    })
    mockPoolQuery.mockRejectedValueOnce(new Error('db down'))

    const result = await resolveWorkflowRunDetails(
      'navikt',
      'db-failure-repo',
      'https://github.com/navikt/db-failure-repo/actions/runs/555',
    )

    expect(result).toEqual({
      headBranch: 'main',
      workflowTrigger: {
        workflowPath: '.github/workflows/deploy.yml',
        triggerEvent: 'push',
        checkSuiteId: 42,
        schemaVersion: 3,
      },
      repositoryId: 999,
    })
  })
})
