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
  it('updates quota state from rejected responses and identifies rate-limit errors', () => {
    expect(
      getGitHubRateLimitError({
        status: 403,
        message: 'API rate limit exceeded',
        response: {
          status: 403,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
          },
          data: { message: 'API rate limit exceeded' },
        },
      }),
    ).toEqual({ remaining: 0 })
    expect(getGitHubRateLimitRemaining()).toBe(0)

    expect(
      getGitHubRateLimitError({
        status: 404,
        response: {
          status: 404,
          headers: {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '123',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
          },
          data: { message: 'Not Found' },
        },
      }),
    ).toBeNull()
    expect(getGitHubRateLimitRemaining()).toBe(123)
  })
})
