import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDeploymentIdsAwaitingCodeDelivery = vi.fn()
const establishCodeDeliveryForDeployment = vi.fn()
const evaluateEstablishmentGrounds = vi.fn()

vi.mock('~/db/repository-code-delivery-establishment.server', () => ({
  getDeploymentIdsAwaitingCodeDelivery: (...args: unknown[]) => getDeploymentIdsAwaitingCodeDelivery(...args),
  establishCodeDeliveryForDeployment: (...args: unknown[]) => establishCodeDeliveryForDeployment(...args),
}))
vi.mock('~/lib/repository-code-delivery/grounds.server', () => ({
  evaluateEstablishmentGrounds: (...args: unknown[]) => evaluateEstablishmentGrounds(...args),
}))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { CODE_DELIVERY_SYNC_LIMIT, syncRepositoryCodeDeliveries } from '../code-delivery-sync.server'

const GROUNDS = { confirmed: true, baseSha: null, headSha: 'a'.repeat(40) }

describe('syncRepositoryCodeDeliveries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
