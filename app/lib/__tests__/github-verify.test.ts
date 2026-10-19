import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/deployments.server', () => ({
  getAllDeployments: vi.fn(),
  getDeploymentById: vi.fn(),
  updateDeploymentFourEyes: vi.fn(),
}))

const { mockPoolQuery, mockRefreshCommitChecksOnly, mockGetRepositoryIdentityById, mockParseWorkflowRunUrl } =
  vi.hoisted(() => ({
    mockPoolQuery: vi.fn(),
    mockRefreshCommitChecksOnly: vi.fn(),
    mockGetRepositoryIdentityById: vi.fn(),
    mockParseWorkflowRunUrl: vi.fn(),
  }))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/sync-jobs.server', () => ({
  isAppBlockedByRunningJob: vi.fn(async () => false),
  VERIFICATION_DIFF_CONFLICT_GROUP: ['reverify_app', 'refresh_missing_approver', 'reverify_all', 'github_verify'],
}))

vi.mock('~/lib/verification', () => ({
  runVerification: vi.fn(),
  refreshCommitChecksOnly: mockRefreshCommitChecksOnly,
}))
vi.mock('~/lib/github/git.server', () => ({
  getRepositoryIdentityById: mockGetRepositoryIdentityById,
  parseWorkflowRunUrl: mockParseWorkflowRunUrl,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  getCurrentJobId: vi.fn(() => undefined),
}))

vi.mock('~/lib/sync/goal-keyword-sync.server', () => ({
  autoLinkGoalKeywords: vi.fn(),
  autoLinkDependabotGoal: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getGitHubRateLimitRemaining: vi.fn(() => null),
}))

import { getAllDeployments, getDeploymentById, updateDeploymentFourEyes } from '~/db/deployments.server'
import { isAppBlockedByRunningJob } from '~/db/sync-jobs.server'
import { getGitHubRateLimitRemaining } from '~/lib/github'
import { getCurrentJobId } from '~/lib/logger.server'
import { reverifyPendingChecks, verifyDeploymentsFourEyes } from '~/lib/sync/github-verify.server'
import { autoLinkDependabotGoal, autoLinkGoalKeywords } from '~/lib/sync/goal-keyword-sync.server'
import { runVerification } from '~/lib/verification'

const mockGetAll = getAllDeployments as Mock
const mockGetById = getDeploymentById as Mock
const mockUpdateFourEyes = updateDeploymentFourEyes as Mock
const mockIsAppBlockedByRunningJob = isAppBlockedByRunningJob as Mock
const mockRunVerification = runVerification as Mock
const mockAutoLink = autoLinkGoalKeywords as Mock
const mockAutoLinkDependabot = autoLinkDependabotGoal as Mock
const mockRateLimitRemaining = getGitHubRateLimitRemaining as Mock
const mockGetCurrentJobId = getCurrentJobId as Mock

function makeDeployment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    nais_deployment_id: 'deploy-1',
    commit_sha: 'abc123',
    four_eyes_status: 'pending',
    detected_github_owner: 'navikt',
    detected_github_repo_name: 'my-app',
    environment_name: 'prod',
    trigger_url: null,
    default_branch: 'main',
    monitored_app_id: 10,
    created_at: '2026-01-15T10:00:00Z',
    ...overrides,
  }
}

describe('verifyDeploymentsFourEyes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockPoolQuery.mockReset()
    mockRefreshCommitChecksOnly.mockReset().mockResolvedValue({})
    mockGetRepositoryIdentityById.mockReset().mockResolvedValue({
      id: 12345,
      owner: 'navikt',
      name: 'current-name',
    })
    mockParseWorkflowRunUrl.mockReset().mockImplementation((url: string | null, owner: string, repo: string) => {
      const match = url?.match(/^https:\/\/github[.]com\/([^/]+)\/([^/]+)\/actions\/runs\/([0-9]+)$/i)
      if (!match || match[1].toLowerCase() !== owner.toLowerCase() || match[2].toLowerCase() !== repo.toLowerCase()) {
        return null
      }
      return { owner: match[1], repo: match[2], runId: Number(match[3]) }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns zeros when no deployments need verification', async () => {
    mockGetAll.mockResolvedValue([])

    const promise = verifyDeploymentsFourEyes({ monitored_app_id: 1 })
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(result).toEqual({ verified: 0, failed: 0, skipped: 0, remaining: 0 })
  })

  it('filters to only pending and error statuses', async () => {
    mockGetAll.mockResolvedValue([
      makeDeployment({ id: 1, four_eyes_status: 'pending' }),
      makeDeployment({ id: 2, four_eyes_status: 'error' }),
      makeDeployment({ id: 3, four_eyes_status: 'direct_push' }),
      makeDeployment({ id: 4, four_eyes_status: 'unverified_commits' }),
      makeDeployment({ id: 5, four_eyes_status: 'missing' }),
    ])
    mockRunVerification.mockResolvedValue({ status: 'approved' })

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(mockRunVerification).toHaveBeenCalledTimes(2)
    expect(result.verified).toBe(2)
  })

  it('skips deployments whose app or repository has a running reverify/refresh job', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, monitored_app_id: 10, four_eyes_status: 'pending' })])
    mockIsAppBlockedByRunningJob.mockResolvedValue(true)

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(mockIsAppBlockedByRunningJob).toHaveBeenCalledWith(
      10,
      ['reverify_app', 'refresh_missing_approver', 'reverify_all', 'github_verify'],
      undefined,
    )
    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result).toEqual({ verified: 0, failed: 0, skipped: 1, remaining: 0 })
  })

  it('verifies deployments when no conflicting job is running', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, monitored_app_id: 10, four_eyes_status: 'pending' })])
    mockIsAppBlockedByRunningJob.mockResolvedValue(false)
    mockRunVerification.mockResolvedValue({ status: 'approved' })

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(mockRunVerification).toHaveBeenCalledTimes(1)
    expect(result.verified).toBe(1)
  })

  it('excludes its own running github_verify job from the conflict check', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, monitored_app_id: 10, four_eyes_status: 'pending' })])
    mockGetCurrentJobId.mockReturnValue(42)
    mockIsAppBlockedByRunningJob.mockResolvedValue(false)
    mockRunVerification.mockResolvedValue({ status: 'approved' })

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(mockIsAppBlockedByRunningJob).toHaveBeenCalledWith(
      10,
      ['reverify_app', 'refresh_missing_approver', 'reverify_all', 'github_verify'],
      42,
    )
  })

  it('skips deployments already approved', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, four_eyes_status: 'approved' })])

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result).toEqual({ verified: 0, failed: 0, skipped: 0, remaining: 0 })
  })

  it('skips legacy four_eyes_status', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, four_eyes_status: 'legacy' })])

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result).toEqual({ verified: 0, failed: 0, skipped: 0, remaining: 0 })
  })

  it('sorts oldest first and applies limit', async () => {
    mockGetAll.mockResolvedValue([
      makeDeployment({ id: 3, created_at: '2026-03-01T00:00:00Z' }),
      makeDeployment({ id: 1, created_at: '2026-01-01T00:00:00Z' }),
      makeDeployment({ id: 2, created_at: '2026-02-01T00:00:00Z' }),
    ])
    mockRunVerification.mockResolvedValue({ status: 'approved' })

    const promise = verifyDeploymentsFourEyes({ limit: 2 })
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(mockRunVerification).toHaveBeenCalledTimes(2)
    const firstCall = mockRunVerification.mock.calls[0]
    expect(firstCall[0]).toBe(1)
    expect(result.verified).toBe(2)
    expect(result.remaining).toBe(1)
  })

  it('stops early when the GitHub rate limit is near exhaustion', async () => {
    mockGetAll.mockResolvedValue([
      makeDeployment({ id: 1, created_at: '2026-01-01T00:00:00Z' }),
      makeDeployment({ id: 2, created_at: '2026-02-01T00:00:00Z' }),
      makeDeployment({ id: 3, created_at: '2026-03-01T00:00:00Z' }),
    ])
    mockRunVerification.mockResolvedValue({ status: 'approved' })
    mockRateLimitRemaining.mockReturnValue(50)

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result).toEqual({ verified: 0, failed: 0, skipped: 0, remaining: 3 })

    mockRateLimitRemaining.mockReturnValue(null)
  })

  it('stops processing further deployments once a rate limit error is thrown', async () => {
    mockGetAll.mockResolvedValue([
      makeDeployment({ id: 1, created_at: '2026-01-01T00:00:00Z' }),
      makeDeployment({ id: 2, created_at: '2026-02-01T00:00:00Z' }),
      makeDeployment({ id: 3, created_at: '2026-03-01T00:00:00Z' }),
    ])
    mockRunVerification
      .mockResolvedValueOnce({ status: 'approved' })
      .mockRejectedValueOnce(new Error('API rate limit exceeded for installation'))

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(mockRunVerification).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ verified: 1, failed: 1, skipped: 0, remaining: 1 })
  })

  it('skips deployments without commit_sha', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, commit_sha: null })])

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })

  it('refreshes Apply checks with the canonical repository name from its immutable association', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 12,
          commit_sha: 'a'.repeat(40),
          deployment_source: 'nais_apply',
          github_repo_id: '12345',
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'current-name',
          claim_github_owner: 'navikt',
          claim_github_repo_name: 'old-name',
          github_pr_number: null,
          trigger_url: 'https://github.com/navikt/old-name/actions/runs/123',
          workflow_trigger_config: null,
        },
      ],
    })

    const resultPromise = reverifyPendingChecks(10)
    await vi.advanceTimersByTimeAsync(100)
    const result = await resultPromise

    expect(mockPoolQuery.mock.calls[0][0]).toContain('LEFT JOIN repositories r ON r.id = d.repository_id')
    expect(mockPoolQuery.mock.calls[0][0]).toContain(
      "(d.deployment_source != 'nais_apply' OR (d.repository_id IS NOT NULL AND r.id IS NOT NULL))",
    )
    expect(mockRefreshCommitChecksOnly).toHaveBeenCalledWith(
      12,
      'navikt',
      'current-name',
      'a'.repeat(40),
      null,
      'https://github.com/navikt/current-name/actions/runs/123',
      null,
    )
    expect(result).toEqual({ fetched: 1, errors: 0 })
  })

  it('marks refs/ SHA as legacy', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, commit_sha: 'refs/heads/main' })])
    mockUpdateFourEyes.mockResolvedValue(undefined)

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(mockUpdateFourEyes).toHaveBeenCalledWith(
      1,
      {
        fourEyesStatus: 'legacy',
        githubPrNumber: null,
        githubPrUrl: null,
      },
      { changeSource: 'sync' },
    )
    expect(result.skipped).toBe(1)
  })

  it('counts skipped when verifySingleDeployment returns error status', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1 }), makeDeployment({ id: 2 })])
    mockRunVerification.mockResolvedValueOnce({ status: 'approved' }).mockResolvedValueOnce({ status: 'error' })

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result.verified).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('counts failed when verifySingleDeployment throws', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1 })])
    mockRunVerification.mockRejectedValue(new Error('rate limit exceeded'))

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result.failed).toBe(1)
    expect(result.verified).toBe(0)
  })

  it('uses default branch from deployment or falls back to main', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, default_branch: 'master' })])
    mockRunVerification.mockResolvedValue({ status: 'approved' })

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    const verifyCall = mockRunVerification.mock.calls[0]
    expect(verifyCall[1].baseBranch).toBe('master')
  })

  it('passes only_missing_four_eyes filter to getAllDeployments', async () => {
    mockGetAll.mockResolvedValue([])

    const promise = verifyDeploymentsFourEyes({ monitored_app_id: 42, limit: 5 })
    await vi.advanceTimersByTimeAsync(0)
    await promise

    expect(mockGetAll).toHaveBeenCalledWith(
      expect.objectContaining({
        monitored_app_id: 42,
        limit: 5,
        only_missing_four_eyes: true,
        per_page: 10000,
      }),
    )
  })

  it('re-reads deployment from DB after verification for keyword auto-linking', async () => {
    const staleDeployment = makeDeployment({
      id: 99,
      team_slug: 'my-team',
      title: null,
      github_pr_data: null,
      unverified_commits: null,
    })

    const freshDeployment = {
      ...staleDeployment,
      title: 'MP-BAU: Fjern automerge av Dependabot pull requests',
      github_pr_data: { title: 'MP-BAU: Fjern automerge av Dependabot pull requests' },
    }

    mockGetAll.mockResolvedValue([staleDeployment])
    mockRunVerification.mockResolvedValue({ status: 'approved' })
    mockGetById.mockResolvedValue(freshDeployment)
    mockAutoLink.mockResolvedValue(1)

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(mockGetById).toHaveBeenCalledWith(99)

    expect(mockAutoLink).toHaveBeenCalledTimes(1)
    const [deploymentId, teamSlug, monitoredAppId, commitInfos] = mockAutoLink.mock.calls[0]
    expect(deploymentId).toBe(99)
    expect(teamSlug).toBe('my-team')
    expect(monitoredAppId).toBe(10)
    expect(commitInfos.some((c: { message: string }) => c.message.includes('MP-BAU'))).toBe(true)
  })

  it('does NOT auto-link if deployment has no title/PR data even after re-read', async () => {
    const deployment = makeDeployment({ id: 50, team_slug: 'team-x', title: null })

    mockGetAll.mockResolvedValue([deployment])
    mockRunVerification.mockResolvedValue({ status: 'approved' })
    mockGetById.mockResolvedValue({ ...deployment, github_pr_data: null, unverified_commits: null })
    mockAutoLink.mockResolvedValue(0)

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(mockGetById).toHaveBeenCalledWith(50)
    expect(mockAutoLink).not.toHaveBeenCalled()
  })

  it('calls autoLinkDependabotGoal for Dependabot PR deployments', async () => {
    const deployment = makeDeployment({
      id: 77,
      team_slug: 'my-team',
      created_at: '2026-02-15T10:00:00Z',
    })

    const freshDeployment = {
      ...deployment,
      title: 'Bump axios from 1.6.0 to 1.7.0',
      github_pr_data: {
        title: 'Bump axios from 1.6.0 to 1.7.0',
        creator: { username: 'dependabot[bot]' },
      },
    }

    mockGetAll.mockResolvedValue([deployment])
    mockRunVerification.mockResolvedValue({ status: 'approved' })
    mockGetById.mockResolvedValue(freshDeployment)
    mockAutoLink.mockResolvedValue(0)
    mockAutoLinkDependabot.mockResolvedValue(1)

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(mockAutoLinkDependabot).toHaveBeenCalledWith(77, 'my-team', 10, expect.any(Date))
  })

  it('does NOT call autoLinkDependabotGoal for non-Dependabot PRs', async () => {
    const deployment = makeDeployment({
      id: 78,
      team_slug: 'my-team',
    })

    const freshDeployment = {
      ...deployment,
      title: 'Add feature X',
      github_pr_data: {
        title: 'Add feature X',
        creator: { username: 'some-developer' },
      },
    }

    mockGetAll.mockResolvedValue([deployment])
    mockRunVerification.mockResolvedValue({ status: 'approved' })
    mockGetById.mockResolvedValue(freshDeployment)
    mockAutoLink.mockResolvedValue(0)

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(mockAutoLinkDependabot).not.toHaveBeenCalled()
  })
})
