import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDeploymentIdsAwaitingCodeDelivery = vi.fn()
const establishCodeDeliveryForDeployment = vi.fn()
const evaluateEstablishmentGrounds = vi.fn()
const claimRepositoryCodeDeliveryAssessmentSyncCandidates = vi.fn()
const deferRepositoryCodeDeliveryAssessmentSync = vi.fn()
const markRepositoryCodeDeliveryAssessmentSyncCompleted = vi.fn()
const markRepositoryCodeDeliveryAssessmentSyncFailed = vi.fn()
const getGitHubRateLimitRemaining = vi.fn()
const ingestRepositoryDeliveryAssessmentSnapshots = vi.fn()

vi.mock('~/db/repository-code-delivery-establishment.server', () => ({
  getDeploymentIdsAwaitingCodeDelivery: (...args: unknown[]) => getDeploymentIdsAwaitingCodeDelivery(...args),
  establishCodeDeliveryForDeployment: (...args: unknown[]) => establishCodeDeliveryForDeployment(...args),
}))
vi.mock('~/lib/repository-code-delivery/grounds.server', () => ({
  evaluateEstablishmentGrounds: (...args: unknown[]) => evaluateEstablishmentGrounds(...args),
}))
vi.mock('~/db/repository-code-delivery-assessment-sync.server', () => ({
  claimRepositoryCodeDeliveryAssessmentSyncCandidates: (...args: unknown[]) =>
    claimRepositoryCodeDeliveryAssessmentSyncCandidates(...args),
  deferRepositoryCodeDeliveryAssessmentSync: (...args: unknown[]) => deferRepositoryCodeDeliveryAssessmentSync(...args),
  markRepositoryCodeDeliveryAssessmentSyncCompleted: (...args: unknown[]) =>
    markRepositoryCodeDeliveryAssessmentSyncCompleted(...args),
  REPOSITORY_CODE_DELIVERY_ASSESSMENT_VERSION: 1,
  markRepositoryCodeDeliveryAssessmentSyncFailed: (...args: unknown[]) =>
    markRepositoryCodeDeliveryAssessmentSyncFailed(...args),
}))
vi.mock('~/lib/github', () => ({
  GITHUB_RATE_LIMIT_SAFETY_BUFFER: 200,
  getGitHubRateLimitRemaining: () => getGitHubRateLimitRemaining(),
}))
vi.mock('~/lib/repository-code-delivery/assessment-snapshots.server', () => ({
  GitHubRateLimitSafetyBufferReachedError: class extends Error {
    constructor(remaining: number) {
      super(`GitHub rate limit safety buffer reached (${remaining} remaining)`)
    }
  },
  ingestRepositoryDeliveryAssessmentSnapshots: (...args: unknown[]) =>
    ingestRepositoryDeliveryAssessmentSnapshots(...args),
}))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GitHubRateLimitSafetyBufferReachedError } from '~/lib/repository-code-delivery/assessment-snapshots.server'
import {
  CODE_DELIVERY_ASSESSMENT_SYNC_LIMIT,
  CODE_DELIVERY_SYNC_LIMIT,
  syncRepositoryCodeDeliveries,
  syncRepositoryCodeDeliveryAssessmentSnapshots,
} from '../code-delivery-sync.server'

const GROUNDS = { confirmed: true, baseSha: null, headSha: 'a'.repeat(40) }

describe('syncRepositoryCodeDeliveries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getGitHubRateLimitRemaining.mockReturnValue(null)
  })

  it('does nothing when no deployments are waiting', async () => {
    getDeploymentIdsAwaitingCodeDelivery.mockResolvedValue([])

    const counts = await syncRepositoryCodeDeliveries()

    expect(getDeploymentIdsAwaitingCodeDelivery).toHaveBeenCalledWith(CODE_DELIVERY_SYNC_LIMIT)
    expect(Object.values(counts).every((count) => count === 0)).toBe(true)
    expect(evaluateEstablishmentGrounds).not.toHaveBeenCalled()
  })

  it('evaluates grounds and establishes deployments in the given order', async () => {
    getDeploymentIdsAwaitingCodeDelivery.mockResolvedValue([3, 1, 2])
    evaluateEstablishmentGrounds.mockResolvedValue(GROUNDS)
    establishCodeDeliveryForDeployment.mockResolvedValue({ outcome: 'created', deliveryId: 1 })

    const counts = await syncRepositoryCodeDeliveries(10)

    expect(getDeploymentIdsAwaitingCodeDelivery).toHaveBeenCalledWith(10)
    expect(establishCodeDeliveryForDeployment.mock.calls.map((call) => call[0])).toEqual([3, 1, 2])
    expect(establishCodeDeliveryForDeployment).toHaveBeenCalledWith(3, GROUNDS)
    expect(counts.created).toBe(3)
  })

  it('counts each outcome and skips deployments without grounds', async () => {
    getDeploymentIdsAwaitingCodeDelivery.mockResolvedValue([1, 2, 3, 4])
    evaluateEstablishmentGrounds.mockResolvedValueOnce(null).mockResolvedValue(GROUNDS)
    establishCodeDeliveryForDeployment
      .mockResolvedValueOnce({ outcome: 'linked', deliveryId: 1 })
      .mockResolvedValueOnce({ outcome: 'unresolved', reason: 'ancestry_unknown' })
      .mockResolvedValueOnce({ outcome: 'stale_grounds' })

    const counts = await syncRepositoryCodeDeliveries()

    expect(counts).toMatchObject({ skipped: 1, linked: 1, unresolved: 1, stale_grounds: 1, failed: 0 })
    expect(establishCodeDeliveryForDeployment).toHaveBeenCalledTimes(3)
  })

  it('continues with the next deployment when one fails', async () => {
    getDeploymentIdsAwaitingCodeDelivery.mockResolvedValue([1, 2])
    evaluateEstablishmentGrounds.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(GROUNDS)
    establishCodeDeliveryForDeployment.mockResolvedValue({ outcome: 'created', deliveryId: 2 })

    const counts = await syncRepositoryCodeDeliveries()

    expect(counts).toMatchObject({ failed: 1, created: 1 })
    expect(establishCodeDeliveryForDeployment).toHaveBeenCalledWith(2, GROUNDS)
  })
})

describe('syncRepositoryCodeDeliveryAssessmentSnapshots', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getGitHubRateLimitRemaining.mockReturnValue(null)
  })

  it('does nothing when the GitHub rate-limit safety buffer is reached', async () => {
    getGitHubRateLimitRemaining.mockReturnValue(199)

    const result = await syncRepositoryCodeDeliveryAssessmentSnapshots()

    expect(result).toMatchObject({ rateLimited: true, processed: 0 })
    expect(claimRepositoryCodeDeliveryAssessmentSyncCandidates).not.toHaveBeenCalled()
  })

  it('ingests and completes claimed deliveries', async () => {
    claimRepositoryCodeDeliveryAssessmentSyncCandidates.mockResolvedValue([{ deliveryId: 17 }])
    ingestRepositoryDeliveryAssessmentSnapshots.mockResolvedValue(undefined)

    const result = await syncRepositoryCodeDeliveryAssessmentSnapshots()

    expect(claimRepositoryCodeDeliveryAssessmentSyncCandidates).toHaveBeenCalledWith(
      CODE_DELIVERY_ASSESSMENT_SYNC_LIMIT,
    )
    expect(ingestRepositoryDeliveryAssessmentSnapshots).toHaveBeenCalledWith(17)
    expect(markRepositoryCodeDeliveryAssessmentSyncCompleted).toHaveBeenCalledWith(17, 1)
    expect(result).toMatchObject({ processed: 1, completed: 1, failed: 0 })
  })

  it('schedules a retry when snapshot ingestion fails', async () => {
    claimRepositoryCodeDeliveryAssessmentSyncCandidates.mockResolvedValue([{ deliveryId: 18 }])
    ingestRepositoryDeliveryAssessmentSnapshots.mockRejectedValue(new Error('GitHub unavailable'))

    const result = await syncRepositoryCodeDeliveryAssessmentSnapshots()

    expect(markRepositoryCodeDeliveryAssessmentSyncFailed).toHaveBeenCalledWith(18, 'GitHub unavailable')
    expect(markRepositoryCodeDeliveryAssessmentSyncCompleted).not.toHaveBeenCalled()
    expect(result).toMatchObject({ processed: 1, completed: 0, failed: 1 })
  })

  it('defers all claimed deliveries when the rate-limit buffer is reached during ingestion', async () => {
    claimRepositoryCodeDeliveryAssessmentSyncCandidates.mockResolvedValue([{ deliveryId: 21 }, { deliveryId: 22 }])
    ingestRepositoryDeliveryAssessmentSnapshots.mockRejectedValue(new GitHubRateLimitSafetyBufferReachedError(199))

    const result = await syncRepositoryCodeDeliveryAssessmentSnapshots()

    expect(deferRepositoryCodeDeliveryAssessmentSync).toHaveBeenCalledTimes(2)
    expect(deferRepositoryCodeDeliveryAssessmentSync).toHaveBeenNthCalledWith(
      1,
      21,
      'GitHub rate limit safety buffer reached (199 remaining)',
    )
    expect(deferRepositoryCodeDeliveryAssessmentSync).toHaveBeenNthCalledWith(
      2,
      22,
      'GitHub rate limit safety buffer reached (199 remaining)',
    )
    expect(markRepositoryCodeDeliveryAssessmentSyncFailed).not.toHaveBeenCalled()
    expect(result).toMatchObject({ rateLimited: true, failed: 0 })
  })

  it('defers claimed deliveries when a GitHub helper swallows a rate-limit error', async () => {
    claimRepositoryCodeDeliveryAssessmentSyncCandidates.mockResolvedValue([{ deliveryId: 24 }, { deliveryId: 25 }])
    ingestRepositoryDeliveryAssessmentSnapshots.mockRejectedValue(new Error('GitHub compare data is unavailable'))
    getGitHubRateLimitRemaining.mockReturnValueOnce(null).mockReturnValue(0)

    const result = await syncRepositoryCodeDeliveryAssessmentSnapshots()

    expect(deferRepositoryCodeDeliveryAssessmentSync).toHaveBeenCalledTimes(2)
    expect(deferRepositoryCodeDeliveryAssessmentSync).toHaveBeenCalledWith(
      24,
      'GitHub rate limit safety buffer reached (0 remaining)',
    )
    expect(deferRepositoryCodeDeliveryAssessmentSync).toHaveBeenCalledWith(
      25,
      'GitHub rate limit safety buffer reached (0 remaining)',
    )
    expect(markRepositoryCodeDeliveryAssessmentSyncFailed).not.toHaveBeenCalled()
    expect(result).toMatchObject({ rateLimited: true, failed: 0 })
  })

  it('reports permanent failures separately from retryable failures', async () => {
    claimRepositoryCodeDeliveryAssessmentSyncCandidates.mockResolvedValue([{ deliveryId: 23 }])
    ingestRepositoryDeliveryAssessmentSnapshots.mockRejectedValue(new Error('not found'))
    markRepositoryCodeDeliveryAssessmentSyncFailed.mockResolvedValue(true)

    const result = await syncRepositoryCodeDeliveryAssessmentSnapshots()

    expect(result).toMatchObject({ failed: 0, permanentlyFailed: 1 })
  })
})
