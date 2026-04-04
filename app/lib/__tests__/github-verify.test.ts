import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

// Mock DB modules
vi.mock('~/db/deployments.server', () => ({
  getAllDeployments: vi.fn(),
  updateDeploymentFourEyes: vi.fn(),
}))

// Mock verification
vi.mock('~/lib/verification', () => ({
  runVerification: vi.fn(),
}))

// Mock logger
vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getAllDeployments, updateDeploymentFourEyes } from '~/db/deployments.server'
import { verifyDeploymentsFourEyes } from '~/lib/sync/github-verify.server'
import { runVerification } from '~/lib/verification'

const mockGetAll = getAllDeployments as Mock
const mockUpdateFourEyes = updateDeploymentFourEyes as Mock
const mockRunVerification = runVerification as Mock

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
    // Use fake timers to skip the 100ms delay between verifications
    vi.useFakeTimers()
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

    expect(result).toEqual({ verified: 0, failed: 0, skipped: 0 })
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

    // Only pending (id:1) and error (id:2) should be verified
    expect(mockRunVerification).toHaveBeenCalledTimes(2)
    expect(result.verified).toBe(2)
  })

  it('skips deployments already approved', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, four_eyes_status: 'approved' })])

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result).toEqual({ verified: 0, failed: 0, skipped: 0 })
  })

  it('skips legacy four_eyes_status', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, four_eyes_status: 'legacy' })])

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result).toEqual({ verified: 0, failed: 0, skipped: 0 })
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

    // Should verify only the 2 oldest (id:1, id:2), not id:3
    expect(mockRunVerification).toHaveBeenCalledTimes(2)
    const firstCall = mockRunVerification.mock.calls[0]
    expect(firstCall[0]).toBe(1) // oldest first
    expect(result.verified).toBe(2)
  })

  it('skips deployments without commit_sha', async () => {
    mockGetAll.mockResolvedValue([makeDeployment({ id: 1, commit_sha: null })])

    const promise = verifyDeploymentsFourEyes()
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(mockRunVerification).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
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
})
