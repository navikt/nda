import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockResolveGithubRepoIdFromWorkflowRunDetailed } = vi.hoisted(() => ({
  mockResolveGithubRepoIdFromWorkflowRunDetailed: vi.fn(),
}))

vi.mock('~/lib/github/git.server', () => ({
  resolveGithubRepoIdFromWorkflowRunDetailed: mockResolveGithubRepoIdFromWorkflowRunDetailed,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('~/db/connection.server', () => ({
  BACKFILL_GITHUB_REPO_ID_LOCK_KEY: 512_338_004,
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}))

import { pool } from '~/db/connection.server'
import {
  backfillDeploymentGithubRepoIds,
  countDeploymentsPendingGithubRepoIdBackfill,
} from '~/lib/github/backfill-deployment-github-repo-id.server'

const mockPoolQuery = pool.query as Mock
const mockPoolConnect = pool.connect as Mock

const candidateRow = (id: number) => ({
  id,
  trigger_url: `https://github.com/navikt/nda/actions/runs/${id}`,
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'nda',
})

function makeLockClient(locked = true) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ locked }] }),
    release: vi.fn(),
  }
}

describe('backfillDeploymentGithubRepoIds', () => {
  beforeEach(() => {
    mockResolveGithubRepoIdFromWorkflowRunDetailed.mockReset()
    mockPoolQuery.mockReset()
    mockPoolConnect.mockReset()
    mockPoolConnect.mockResolvedValue(makeLockClient(true))
  })

  it('resolves and updates rows, then reports the remaining count', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [candidateRow(1), candidateRow(2)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })

    mockResolveGithubRepoIdFromWorkflowRunDetailed
      .mockResolvedValueOnce({ repositoryId: 111, permanentFailure: false })
      .mockResolvedValueOnce({ repositoryId: 222, permanentFailure: false })

    const result = await backfillDeploymentGithubRepoIds()

    expect(result).toEqual({
      processed: 2,
      resolved: 2,
      unresolved: 0,
      transientFailures: 0,
      remaining: 0,
      truncated: false,
      alreadyRunning: false,
    })
    expect(mockPoolQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE deployments'), [111, 1])
    expect(mockPoolQuery).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE deployments'), [222, 2])
  })

  it('marks permanently unresolved rows as attempted so they are excluded from future candidates', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [candidateRow(1)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })

    mockResolveGithubRepoIdFromWorkflowRunDetailed.mockResolvedValueOnce({
      repositoryId: null,
      permanentFailure: true,
    })

    const result = await backfillDeploymentGithubRepoIds()

    expect(result).toEqual({
      processed: 1,
      resolved: 0,
      unresolved: 1,
      transientFailures: 0,
      remaining: 3,
      truncated: false,
      alreadyRunning: false,
    })
    expect(mockPoolQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('github_repo_id_backfill_attempted_at = now()'),
      [1],
    )
    expect(mockPoolQuery).toHaveBeenCalledTimes(3)
  })

  it('does not mark transiently failed rows as attempted, leaving them eligible for retry', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [candidateRow(1)] }).mockResolvedValueOnce({ rows: [{ count: '1' }] })

    mockResolveGithubRepoIdFromWorkflowRunDetailed.mockResolvedValueOnce({
      repositoryId: null,
      permanentFailure: false,
    })

    const result = await backfillDeploymentGithubRepoIds()

    expect(result).toEqual({
      processed: 1,
      resolved: 0,
      unresolved: 0,
      transientFailures: 1,
      remaining: 1,
      truncated: false,
      alreadyRunning: false,
    })
    expect(mockPoolQuery).toHaveBeenCalledTimes(2)
    expect(mockPoolQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE deployments'), expect.anything())
  })

  it('marks the result truncated once the time budget is exceeded', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [candidateRow(1), candidateRow(2)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })

    mockResolveGithubRepoIdFromWorkflowRunDetailed.mockResolvedValueOnce({
      repositoryId: 111,
      permanentFailure: false,
    })

    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1050)

    const result = await backfillDeploymentGithubRepoIds({ timeBudgetMs: 0 })

    dateNowSpy.mockRestore()

    expect(result.truncated).toBe(true)
    expect(result.resolved).toBe(1)
    expect(mockResolveGithubRepoIdFromWorkflowRunDetailed).toHaveBeenCalledTimes(1)
  })

  it('marks the result truncated when maxRows caps the candidate query', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [candidateRow(1)] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })

    mockResolveGithubRepoIdFromWorkflowRunDetailed.mockResolvedValueOnce({
      repositoryId: 111,
      permanentFailure: false,
    })

    const result = await backfillDeploymentGithubRepoIds({ maxRows: 1 })

    expect(mockPoolQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('LIMIT $1'), [1])
    expect(result.remaining).toBe(5)
  })

  it('skips the batch without touching the pool when the advisory lock is already held', async () => {
    mockPoolConnect.mockResolvedValue(makeLockClient(false))
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: '42' }] })

    const result = await backfillDeploymentGithubRepoIds()

    expect(result).toEqual({
      processed: 0,
      resolved: 0,
      unresolved: 0,
      transientFailures: 0,
      remaining: 42,
      truncated: true,
      alreadyRunning: true,
    })
    expect(mockResolveGithubRepoIdFromWorkflowRunDetailed).not.toHaveBeenCalled()
    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
  })
})

describe('countDeploymentsPendingGithubRepoIdBackfill', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
  })

  it('returns the pending count as a number', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ count: '42' }] })

    const count = await countDeploymentsPendingGithubRepoIdBackfill()

    expect(count).toBe(42)
  })
})
