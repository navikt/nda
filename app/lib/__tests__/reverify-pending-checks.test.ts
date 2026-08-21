import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/deployments.server', () => ({
  getAllDeployments: vi.fn(),
  getDeploymentById: vi.fn(),
  updateDeploymentFourEyes: vi.fn(),
}))

vi.mock('~/lib/verification', () => ({
  runVerification: vi.fn(),
  refreshCommitChecksOnly: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('~/lib/sync/goal-keyword-sync.server', () => ({
  autoLinkGoalKeywords: vi.fn(),
  autoLinkDependabotGoal: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getGitHubRateLimitRemaining: vi.fn(() => null),
}))

import { getGitHubRateLimitRemaining } from '~/lib/github'
import { CHECKS_REVERIFY_GIVE_UP_MS, reverifyPendingChecks } from '~/lib/sync/github-verify.server'
import { refreshCommitChecksOnly } from '~/lib/verification'

const mockRefreshChecksOnly = refreshCommitChecksOnly as Mock
const mockRateLimitRemaining = getGitHubRateLimitRemaining as Mock

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    commit_sha: 'abc123',
    detected_github_owner: 'navikt',
    detected_github_repo_name: 'my-app',
    github_pr_number: null,
    ...overrides,
  }
}

describe('reverifyPendingChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns zeros when no deployments have pending checks', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await reverifyPendingChecks(1)

    expect(result).toEqual({ fetched: 0, errors: 0 })
    expect(mockRefreshChecksOnly).not.toHaveBeenCalled()
  })

  it('only queries deployments whose four_eyes_status is already resolved and checks not yet definitive', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    await reverifyPendingChecks(42, 25)

    const [sql, params] = mockPoolQuery.mock.calls[0]
    expect(sql).toContain('commit_checks_checked_at IS NULL')
    expect(sql).toContain("NOT IN ('pending', 'pending_baseline', 'unknown', 'error')")
    expect(sql).toContain('d.created_at >')
    expect(params[0]).toBe(42)
    expect(params[2]).toBe(25)
  })

  it('bounds the query by CHECKS_REVERIFY_GIVE_UP_MS so old, never-converging checks are excluded', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const before = Date.now()
    await reverifyPendingChecks(1)
    const after = Date.now()

    const [, params] = mockPoolQuery.mock.calls[0]
    const giveUpBefore = (params[1] as Date).getTime()
    expect(giveUpBefore).toBeGreaterThanOrEqual(before - CHECKS_REVERIFY_GIVE_UP_MS - 1000)
    expect(giveUpBefore).toBeLessThanOrEqual(after - CHECKS_REVERIFY_GIVE_UP_MS + 1000)
  })

  it('refreshes checks for each matched deployment', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [makeRow({ id: 1 }), makeRow({ id: 2, github_pr_number: 7 })],
    })
    mockRefreshChecksOnly.mockResolvedValue({ commitChecks: undefined, attempted: false })

    const result = await reverifyPendingChecks(1)

    expect(mockRefreshChecksOnly).toHaveBeenCalledTimes(2)
    expect(mockRefreshChecksOnly).toHaveBeenNthCalledWith(
      1,
      1,
      'navikt',
      'my-app',
      'abc123',
      null,
      undefined,
      undefined,
    )
    expect(mockRefreshChecksOnly).toHaveBeenNthCalledWith(2, 2, 'navikt', 'my-app', 'abc123', 7, undefined, undefined)
    expect(result).toEqual({ fetched: 2, errors: 0 })
  })

  it('counts errors without stopping the rest of the batch', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [makeRow({ id: 1 }), makeRow({ id: 2 })],
    })
    mockRefreshChecksOnly
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ commitChecks: undefined, attempted: false })

    const result = await reverifyPendingChecks(1)

    expect(mockRefreshChecksOnly).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ fetched: 1, errors: 1 })
  })

  it('stops early when the GitHub rate limit is near exhaustion', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [makeRow({ id: 1 }), makeRow({ id: 2 })],
    })
    mockRateLimitRemaining.mockReturnValue(50)

    const result = await reverifyPendingChecks(1)

    expect(mockRefreshChecksOnly).not.toHaveBeenCalled()
    expect(result).toEqual({ fetched: 0, errors: 0 })
  })
})
