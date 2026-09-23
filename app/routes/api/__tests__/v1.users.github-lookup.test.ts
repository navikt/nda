import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/m2m-auth.server', () => ({
  requireM2MToken: vi.fn().mockResolvedValue({ azp: 'kiss', azpName: 'KISS', roles: ['access_as_application'] }),
}))

const mockGetGithubUserLookups = vi.fn()
vi.mock('~/db/user-github-lookups.server', () => ({
  getGithubUserLookups: (...args: unknown[]) => mockGetGithubUserLookups(...args),
}))

import { action } from '../v1.users.github-lookup'

async function expectRejectsWithStatus(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise
    throw new Error('Expected action to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(Response)
    expect((error as Response).status).toBe(status)
  }
}

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

  it('resolves bot usernames via the static bot mapping even when the database has no matching row', async () => {
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
    expect(mockGetGithubUserLookups).toHaveBeenCalledWith(['dependabot[bot]'])
  })

  it('resolves bot usernames case-insensitively, matching the case-insensitive database lookup', async () => {
    mockGetGithubUserLookups.mockResolvedValue(new Map())

    const response = await action({
      request: makeRequest({ githubUsernames: ['Dependabot[bot]'] }),
      params: {},
      context: {},
    } as never)

    const body = await response.json()
    expect(body.users).toEqual([
      { githubUsername: 'Dependabot[bot]', displayName: 'Dependabot', navIdent: null, found: true },
    ])
  })

  it('treats a soft-deleted bot mapping as not found, even though a static bot mapping exists', async () => {
    mockGetGithubUserLookups.mockResolvedValue(
      new Map([
        [
          'dependabot[bot]',
          {
            github_username: 'dependabot[bot]',
            display_github_username: 'dependabot[bot]',
            display_name: null,
            nav_ident: null,
            slack_member_id: null,
            account_deleted_at: new Date(),
          },
        ],
      ]),
    )

    const response = await action({
      request: makeRequest({ githubUsernames: ['dependabot[bot]'] }),
      params: {},
      context: {},
    } as never)

    const body = await response.json()
    expect(body.users).toEqual([{ githubUsername: 'dependabot[bot]', displayName: null, navIdent: null, found: false }])
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

  it('rejects a null request body instead of throwing an unhandled TypeError', async () => {
    await expectRejectsWithStatus(action({ request: makeRequest(null), params: {}, context: {} } as never), 400)
  })

  it('rejects invalid JSON in the request body', async () => {
    const request = new Request('http://localhost/api/v1/users/github-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    })

    await expectRejectsWithStatus(action({ request, params: {}, context: {} } as never), 400)
  })

  it('rejects an explicitly empty githubUsernames array', async () => {
    await expectRejectsWithStatus(
      action({ request: makeRequest({ githubUsernames: [] }), params: {}, context: {} } as never),
      400,
    )
  })

  it('rejects empty/whitespace usernames instead of silently dropping them', async () => {
    mockGetGithubUserLookups.mockResolvedValue(new Map())

    await expectRejectsWithStatus(
      action({
        request: makeRequest({ githubUsernames: ['known-user', '', '  '] }),
        params: {},
        context: {},
      } as never),
      400,
    )
    expect(mockGetGithubUserLookups).not.toHaveBeenCalled()
  })

  it('rejects requests without a githubUsernames array', async () => {
    await expectRejectsWithStatus(
      action({ request: makeRequest({ githubUsernames: 'not-an-array' }), params: {}, context: {} } as never),
      400,
    )
  })

  it('rejects requests exceeding the max batch size', async () => {
    const usernames = Array.from({ length: 501 }, (_, i) => `user-${i}`)
    await expectRejectsWithStatus(
      action({ request: makeRequest({ githubUsernames: usernames }), params: {}, context: {} } as never),
      400,
    )
  })
})
