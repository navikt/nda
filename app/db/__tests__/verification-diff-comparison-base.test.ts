import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

const { getEffectiveComparisonBaseSha } = await import('../verification-diff.server')

describe('getEffectiveComparisonBaseSha', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
  })

  it('uses the comparison range stored by the latest verification run', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ comparison_range: { baseSha: 'verified-base', headSha: 'head-sha' } }],
    })

    await expect(getEffectiveComparisonBaseSha(1, 'repo-1', 'head-sha')).resolves.toBe('verified-base')
    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
  })

  it('preserves a verified null base rather than deriving a later base', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ comparison_range: { baseSha: null, headSha: 'head-sha' } }],
    })

    await expect(getEffectiveComparisonBaseSha(1, 'repo-1', 'head-sha')).resolves.toBeNull()
    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
  })

  it('derives a base dynamically when no matching verification range is stored', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ comparison_range: { baseSha: 'old-base', headSha: 'other-head' } }] })
      .mockResolvedValueOnce({ rows: [{ commit_sha: 'current-base', created_at: new Date() }] })

    await expect(getEffectiveComparisonBaseSha(1, 'repo-1', 'head-sha')).resolves.toBe('current-base')
    expect(mockPoolQuery).toHaveBeenCalledTimes(2)
  })

  it('derives the current base when no approved matching run is available', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ commit_sha: 'current-base', created_at: new Date() }] })

    await expect(getEffectiveComparisonBaseSha(1, 'repo-1', 'head-sha')).resolves.toBe('current-base')
    expect(mockPoolQuery).toHaveBeenCalledTimes(2)
  })
})
