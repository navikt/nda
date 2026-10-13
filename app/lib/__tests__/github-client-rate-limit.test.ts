import { describe, expect, it, vi } from 'vitest'

vi.mock('@octokit/auth-app', () => ({
  createAppAuth: vi.fn(),
}))

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    hook = {
      after: vi.fn(),
      before: vi.fn(),
      wrap: vi.fn(),
    }
  },
}))

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createObservableGauge: () => ({ addCallback: vi.fn() }),
    }),
  },
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    warn: vi.fn(),
  },
  logOutgoingHttp: vi.fn(),
}))

vi.mock('~/lib/tracing.server', () => ({
  withGitHubSpan: vi.fn(),
}))

import { getGitHubRateLimitError, getGitHubRateLimitRemaining } from '~/lib/github/client.server'

describe('GitHub rate-limit error handling', () => {
  it('updates quota from rejected responses and blocks requests after secondary rate limits', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T22:00:00Z'))

    try {
      expect(
        getGitHubRateLimitError({
          status: 403,
          message: 'You have exceeded a secondary rate limit',
          response: {
            status: 403,
            headers: {
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '900',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
              'retry-after': '60',
            },
            data: { message: 'You have exceeded a secondary rate limit' },
          },
        }),
      ).toEqual({ remaining: 900 })
      expect(getGitHubRateLimitRemaining()).toBe(0)

      vi.advanceTimersByTime(60_001)
      expect(
        getGitHubRateLimitError({
          status: 404,
          response: {
            status: 404,
            headers: {
              'x-ratelimit-limit': '5000',
              'x-ratelimit-remaining': '123',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
            },
            data: { message: 'Not Found' },
          },
        }),
      ).toBeNull()
      expect(getGitHubRateLimitRemaining()).toBe(123)
    } finally {
      vi.useRealTimers()
    }
  })
})
