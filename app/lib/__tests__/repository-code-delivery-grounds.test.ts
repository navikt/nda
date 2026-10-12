import { beforeEach, describe, expect, it, vi } from 'vitest'

const getEstablishmentContext = vi.fn()
const isCommitOnBranch = vi.fn()
const getCommitAncestryStatus = vi.fn()
const getRepositoryId = vi.fn()

vi.mock('~/db/repository-code-delivery-establishment.server', () => ({
  getEstablishmentContext: (...args: unknown[]) => getEstablishmentContext(...args),
}))
vi.mock('~/lib/github', () => ({
  isCommitOnBranch: (...args: unknown[]) => isCommitOnBranch(...args),
  getCommitAncestryStatus: (...args: unknown[]) => getCommitAncestryStatus(...args),
  getRepositoryId: (...args: unknown[]) => getRepositoryId(...args),
}))

import { decideEstablishmentGrounds } from '../repository-code-delivery/grounds'
import { evaluateEstablishmentGrounds } from '../repository-code-delivery/grounds.server'

const HEAD = 'b'.repeat(40)
const BASE = 'a'.repeat(40)

describe('decideEstablishmentGrounds', () => {
  it('confirms a forward continuation on the approved branch', () => {
    expect(
      decideEstablishmentGrounds({ headSha: HEAD, baseSha: BASE, onApprovedBranch: true, ancestry: 'ahead' }),
    ).toEqual({ confirmed: true, baseSha: BASE, headSha: HEAD })
  })

  it('confirms the first delivery without a base when the source is approved', () => {
    expect(
      decideEstablishmentGrounds({ headSha: HEAD, baseSha: null, onApprovedBranch: true, ancestry: 'not_required' }),
    ).toEqual({ confirmed: true, baseSha: null, headSha: HEAD })
  })

  it.each([false, null])('reports an unauthorized source when branch membership is %s', (onApprovedBranch) => {
    expect(decideEstablishmentGrounds({ headSha: HEAD, baseSha: BASE, onApprovedBranch, ancestry: 'ahead' })).toEqual({
      confirmed: false,
      reason: 'source_unauthorized',
      headSha: HEAD,
    })
  })

  it('reports unknown ancestry when the comparison failed', () => {
    expect(
      decideEstablishmentGrounds({ headSha: HEAD, baseSha: BASE, onApprovedBranch: true, ancestry: null }),
    ).toEqual({ confirmed: false, reason: 'ancestry_unknown', headSha: HEAD })
  })

  it.each(['diverged', 'behind', 'identical'] as const)('does not confirm ancestry status %s', (ancestry) => {
    expect(decideEstablishmentGrounds({ headSha: HEAD, baseSha: BASE, onApprovedBranch: true, ancestry })).toEqual({
      confirmed: false,
      reason: 'ancestry_diverged',
      headSha: HEAD,
    })
  })
})

describe('evaluateEstablishmentGrounds', () => {
  const context = {
    repositoryId: 1,
    githubOwner: 'navikt',
    githubRepoName: 'repo-fjord',
    githubRepoId: 77,
    defaultBranch: 'main',
    headSha: HEAD,
    latestDeliveryHeadSha: BASE,
    headHasDelivery: false,
  }

  beforeEach(() => {
    vi.resetAllMocks()
    getRepositoryId.mockResolvedValue(77)
  })

  it.each([
    ['a different repository id', 78],
    ['a failed lookup', null],
  ])('reports an unauthorized source and makes no further calls for %s', async (_label, resolvedId) => {
    getEstablishmentContext.mockResolvedValue(context)
    getRepositoryId.mockResolvedValue(resolvedId)

    expect(await evaluateEstablishmentGrounds(1)).toEqual({
      confirmed: false,
      reason: 'source_unauthorized',
      headSha: HEAD,
    })
    expect(getRepositoryId).toHaveBeenCalledWith('navikt', 'repo-fjord')
    expect(isCommitOnBranch).not.toHaveBeenCalled()
    expect(getCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('returns null when there is nothing to evaluate', async () => {
    getEstablishmentContext.mockResolvedValue(null)

    expect(await evaluateEstablishmentGrounds(1)).toBeNull()
    expect(isCommitOnBranch).not.toHaveBeenCalled()
  })

  it('compares the latest delivery head with the deployment head', async () => {
    getEstablishmentContext.mockResolvedValue(context)
    isCommitOnBranch.mockResolvedValue(true)
    getCommitAncestryStatus.mockResolvedValue('ahead')

    expect(await evaluateEstablishmentGrounds(1)).toEqual({ confirmed: true, baseSha: BASE, headSha: HEAD })
    expect(isCommitOnBranch).toHaveBeenCalledWith('navikt', 'repo-fjord', HEAD, 'main')
    expect(getCommitAncestryStatus).toHaveBeenCalledWith('navikt', 'repo-fjord', BASE, HEAD, 77)
  })

  it('skips the ancestry comparison for the first delivery', async () => {
    getEstablishmentContext.mockResolvedValue({ ...context, latestDeliveryHeadSha: null })
    isCommitOnBranch.mockResolvedValue(true)

    expect(await evaluateEstablishmentGrounds(1)).toEqual({ confirmed: true, baseSha: null, headSha: HEAD })
    expect(getCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('skips the ancestry comparison when the head already has a delivery', async () => {
    getEstablishmentContext.mockResolvedValue({ ...context, headHasDelivery: true })
    isCommitOnBranch.mockResolvedValue(true)

    expect((await evaluateEstablishmentGrounds(1))?.confirmed).toBe(true)
    expect(getCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('does not compare ancestry when the source is not approved', async () => {
    getEstablishmentContext.mockResolvedValue(context)
    isCommitOnBranch.mockResolvedValue(false)

    expect(await evaluateEstablishmentGrounds(1)).toEqual({
      confirmed: false,
      reason: 'source_unauthorized',
      headSha: HEAD,
    })
    expect(getCommitAncestryStatus).not.toHaveBeenCalled()
  })

  it('reports an unauthorized source without a default branch', async () => {
    getEstablishmentContext.mockResolvedValue({ ...context, defaultBranch: null })

    expect(await evaluateEstablishmentGrounds(1)).toEqual({
      confirmed: false,
      reason: 'source_unauthorized',
      headSha: HEAD,
    })
    expect(isCommitOnBranch).not.toHaveBeenCalled()
  })
})
