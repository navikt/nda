import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/m2m-auth.server', () => ({
  requireM2MToken: vi.fn().mockResolvedValue({ azp: 'kiss', azpName: 'KISS', roles: ['access_as_application'] }),
}))

const mockGetGithubUserLookups = vi.fn()
vi.mock('~/db/user-github-lookups.server', () => ({
  getGithubUserLookups: (...args: unknown[]) => mockGetGithubUserLookups(...args),
}))

import { action } from '../v1.users.github-lookup'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/users/github-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/users/github-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns display names for known users and found: false for unknown ones', async () => {
    mockGetGithubUserLookups.mockResolvedValue(
      new Map([
        [
          'known-user',
          {
            github_username: 'known-user',
            display_github_username: 'known-user',
            display_name: 'Glad Fjord',
            nav_ident: 'Z990001',
            slack_member_id: null,
            account_deleted_at: null,
          },
        ],
      ]),
    )

    const response = await action({
      request: makeRequest({ githubUsernames: ['known-user', 'unknown-user'] }),
      params: {},
      context: {},
    } as never)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      users: [
        { githubUsername: 'known-user', displayName: 'Glad Fjord', navIdent: 'Z990001', found: true },
        { githubUsername: 'unknown-user', displayName: null, navIdent: null, found: false },
      ],
    })
  })

  it('resolves bot usernames without hitting the database mapping', async () => {
    mockGetGithubUserLookups.mockResolvedValue(new Map())

    const response = await action({
      request: makeRequest({ githubUsernames: ['dependabot[bot]'] }),
      params: {},
      context: {},
    } as never)

    const body = await response.json()
    expect(body.users).toEqual([
      { githubUsername: 'dependabot[bot]', displayName: 'Dependabot', navIdent: null, found: true },
    ])
  })

  it('treats soft-deleted accounts as not found', async () => {
    mockGetGithubUserLookups.mockResolvedValue(
      new Map([
        [
          'left-user',
          {
            github_username: 'left-user',
            display_github_username: 'left-user',
            display_name: 'Gammel Bruker',
            nav_ident: 'Z990002',
            slack_member_id: null,
            account_deleted_at: new Date(),
          },
        ],
      ]),
    )

    const response = await action({
      request: makeRequest({ githubUsernames: ['left-user'] }),
      params: {},
      context: {},
    } as never)

    const body = await response.json()
    expect(body.users).toEqual([{ githubUsername: 'left-user', displayName: null, navIdent: null, found: false }])
  })

  it('rejects requests without a githubUsernames array', async () => {
    await expect(
      action({ request: makeRequest({ githubUsernames: 'not-an-array' }), params: {}, context: {} } as never),
    ).rejects.toThrow()
  })

  it('rejects requests exceeding the max batch size', async () => {
    const usernames = Array.from({ length: 501 }, (_, i) => `user-${i}`)
    await expect(
      action({ request: makeRequest({ githubUsernames: usernames }), params: {}, context: {} } as never),
    ).rejects.toThrow()
  })
})
