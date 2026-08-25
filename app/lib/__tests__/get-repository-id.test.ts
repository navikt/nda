import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReposGet = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
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

import { getRepositoryId } from '~/lib/github/git.server'

describe('getRepositoryId', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves the repository id from GitHub', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 123 } })

    const result = await getRepositoryId('navikt', 'nda')

    expect(result).toBe(123)
    expect(mockReposGet).toHaveBeenCalledWith({ owner: 'navikt', repo: 'nda' })
  })

  it('caches the repository id per owner/repo, so subsequent calls do not hit GitHub again', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 456 } })

    const first = await getRepositoryId('navikt', 'other-repo')
    const second = await getRepositoryId('navikt', 'other-repo')

    expect(first).toBe(456)
    expect(second).toBe(456)
    expect(mockReposGet).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed lookup, so a later call can retry', async () => {
    mockReposGet.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { id: 789 } })

    const first = await getRepositoryId('navikt', 'retry-repo')
    const second = await getRepositoryId('navikt', 'retry-repo')

    expect(first).toBeNull()
    expect(second).toBe(789)
    expect(mockReposGet).toHaveBeenCalledTimes(2)
  })

  it('re-resolves the repository id after the cache entry expires, so a deleted-and-recreated repo gets a fresh id', async () => {
    mockReposGet.mockResolvedValueOnce({ data: { id: 111 } }).mockResolvedValueOnce({ data: { id: 222 } })

    const first = await getRepositoryId('navikt', 'expiring-repo')
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    const second = await getRepositoryId('navikt', 'expiring-repo')

    expect(first).toBe(111)
    expect(second).toBe(222)
    expect(mockReposGet).toHaveBeenCalledTimes(2)
  })
})
