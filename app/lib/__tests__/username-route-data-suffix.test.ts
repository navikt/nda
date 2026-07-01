import { describe, expect, it, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}))

vi.mock('~/lib/auth.server', () => ({
  requireUser: vi.fn().mockResolvedValue({ navIdent: 'Z990001', role: 'user' }),
}))

vi.mock('~/db/user-github-lookups.server', () => ({
  getUserByIdentifier: vi.fn().mockResolvedValue({ github_username: 'glad-fjord' }),
  upsertUserAndGithubAccount: vi.fn(),
}))

import { loader } from '../../routes/users/$username'

function makeArgs(username: string, rawUrl: string, normalizedUrl: string) {
  return {
    request: new Request(rawUrl),
    params: { username },
    url: new URL(normalizedUrl),
  } as never
}

describe('users/$username loader redirect (React Router v8 .data suffix)', () => {
  it('redirects to the canonical github username without leaking the .data suffix from request.url', async () => {
    let redirectResponse: Response | undefined
    try {
      await loader(makeArgs('Z990001', 'http://localhost/users/Z990001.data', 'http://localhost/users/Z990001'))
    } catch (thrown) {
      redirectResponse = thrown as Response
    }

    expect(redirectResponse).toBeInstanceOf(Response)
    const location = redirectResponse?.headers.get('Location')
    expect(location).toBe('/users/glad-fjord')
    expect(location).not.toContain('.data')
  })

  it('preserves query params from the normalized url, not stray single-fetch params from request.url', async () => {
    let redirectResponse: Response | undefined
    try {
      await loader(
        makeArgs(
          'Z990001',
          'http://localhost/users/Z990001.data?_routes=routes%2Fusers.%24username&period=year-to-date',
          'http://localhost/users/Z990001?period=year-to-date',
        ),
      )
    } catch (thrown) {
      redirectResponse = thrown as Response
    }

    const location = redirectResponse?.headers.get('Location')
    expect(location).toBe('/users/glad-fjord?period=year-to-date')
    expect(location).not.toContain('_routes')
  })
})
