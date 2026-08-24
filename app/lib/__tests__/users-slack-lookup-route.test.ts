import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/auth.server', () => ({
  requireUser: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  canSearchUsers: vi.fn(),
}))

vi.mock('~/lib/user-lookup.server', () => ({
  getUsersByNavIdenter: vi.fn(),
}))

vi.mock('~/lib/slack/client.server', () => ({
  isSlackConfigured: vi.fn(),
  lookupSlackUserIdByEmail: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn() },
}))

import { requireUser } from '~/lib/auth.server'
import { canSearchUsers } from '~/lib/authorization.server'
import { isSlackConfigured, lookupSlackUserIdByEmail } from '~/lib/slack/client.server'
import { getUsersByNavIdenter } from '~/lib/user-lookup.server'
import { loader } from '../../routes/api/users.slack-lookup'

function makeArgs(navIdent = '') {
  const url = new URL(`http://localhost/api/users/slack-lookup?nav_ident=${encodeURIComponent(navIdent)}`)
  return { request: new Request(url.toString()), url }
}

const mockUser = { navIdent: 'Z990001', name: 'Glad Fjord', role: 'user' }

describe('users.slack-lookup loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue(mockUser as never)
    vi.mocked(canSearchUsers).mockResolvedValue(true)
    vi.mocked(isSlackConfigured).mockReturnValue(true)
  })

  it('returns 400 with Cache-Control: no-store for an invalid NAV-ident', async () => {
    const response = await loader(makeArgs('not-a-nav-ident') as never)

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.slackMemberId).toBeNull()
  })

  it('allows self-service lookup for the logged in user without canSearchUsers', async () => {
    vi.mocked(canSearchUsers).mockResolvedValue(false)
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { displayName: 'Glad Fjord', navIdent: 'Z990001', email: 'glad.fjord@nav.no' },
    ])
    vi.mocked(lookupSlackUserIdByEmail).mockResolvedValue('U123456')

    const response = await loader(makeArgs('Z990001') as never)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.slackMemberId).toBe('U123456')
  })

  it('returns 403 when looking up another user without permission', async () => {
    vi.mocked(canSearchUsers).mockResolvedValue(false)

    const response = await loader(makeArgs('Z990002') as never)

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.slackMemberId).toBeNull()
    expect(data.error).toBe('Ingen tilgang')
  })

  it('returns null when Slack is not configured', async () => {
    vi.mocked(isSlackConfigured).mockReturnValue(false)

    const response = await loader(makeArgs('Z990002') as never)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.slackMemberId).toBeNull()
    expect(getUsersByNavIdenter).not.toHaveBeenCalled()
  })

  it('returns null when the NAV-ident has no matching NOM user', async () => {
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([])

    const response = await loader(makeArgs('Z990002') as never)

    const data = await response.json()
    expect(data.slackMemberId).toBeNull()
    expect(lookupSlackUserIdByEmail).not.toHaveBeenCalled()
  })

  it('returns null when the matching NOM user has no email', async () => {
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([{ displayName: 'Rask Elv', navIdent: 'Z990002', email: null }])

    const response = await loader(makeArgs('Z990002') as never)

    const data = await response.json()
    expect(data.slackMemberId).toBeNull()
    expect(lookupSlackUserIdByEmail).not.toHaveBeenCalled()
  })

  it('returns the Slack member ID resolved via the NOM user email', async () => {
    vi.mocked(getUsersByNavIdenter).mockResolvedValue([
      { displayName: 'Rask Elv', navIdent: 'Z990002', email: 'rask.elv@nav.no' },
    ])
    vi.mocked(lookupSlackUserIdByEmail).mockResolvedValue('U654321')

    const response = await loader(makeArgs('Z990002') as never)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.slackMemberId).toBe('U654321')
    expect(lookupSlackUserIdByEmail).toHaveBeenCalledWith('rask.elv@nav.no')
  })

  it('returns null with Cache-Control: no-store when the lookup throws', async () => {
    vi.mocked(getUsersByNavIdenter).mockRejectedValue(new Error('NOM API error'))

    const response = await loader(makeArgs('Z990002') as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.slackMemberId).toBeNull()
  })
})
