import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
  fetchWithLogging: vi.fn(),
  logOutgoingHttp: vi.fn(),
}))

vi.mock('~/lib/nom.server', () => ({
  getNomUsersByNavIdenter: vi.fn(),
  searchNomUsers: vi.fn(),
}))

vi.mock('~/lib/microsoft-graph.server', () => ({
  getGraphUsersByNavIdenter: vi.fn(),
  searchGraphUsers: vi.fn(),
}))

describe('user-lookup.server', () => {
  const originalProvider = process.env.USER_LOOKUP_PROVIDER

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.USER_LOOKUP_PROVIDER
    } else {
      process.env.USER_LOOKUP_PROVIDER = originalProvider
    }
    vi.restoreAllMocks()
  })

  async function getModule() {
    return import('../user-lookup.server')
  }

  it('defaults to NOM when USER_LOOKUP_PROVIDER is not set', async () => {
    delete process.env.USER_LOOKUP_PROVIDER
    const { getUserLookupProviderName } = await getModule()
    expect(getUserLookupProviderName()).toBe('nom')
  })

  it('uses NOM when USER_LOOKUP_PROVIDER=nom', async () => {
    process.env.USER_LOOKUP_PROVIDER = 'nom'
    const { getUsersByNavIdenter } = await getModule()
    const { getNomUsersByNavIdenter } = await import('~/lib/nom.server')
    const { getGraphUsersByNavIdenter } = await import('~/lib/microsoft-graph.server')
    vi.mocked(getNomUsersByNavIdenter).mockResolvedValue([])

    await getUsersByNavIdenter(['Z990001'])

    expect(getNomUsersByNavIdenter).toHaveBeenCalledWith(['Z990001'])
    expect(getGraphUsersByNavIdenter).not.toHaveBeenCalled()
  })

  it('uses Entra ID when USER_LOOKUP_PROVIDER=entra_id', async () => {
    process.env.USER_LOOKUP_PROVIDER = 'entra_id'
    const { searchUsers } = await getModule()
    const { searchNomUsers } = await import('~/lib/nom.server')
    const { searchGraphUsers } = await import('~/lib/microsoft-graph.server')
    vi.mocked(searchGraphUsers).mockResolvedValue([])

    await searchUsers('query')

    expect(searchGraphUsers).toHaveBeenCalledWith('query')
    expect(searchNomUsers).not.toHaveBeenCalled()
  })

  it('falls back to NOM and logs a warning for an unknown provider value', async () => {
    process.env.USER_LOOKUP_PROVIDER = 'something-invalid'
    const { getUserLookupProviderName } = await getModule()
    const { logger } = await import('~/lib/logger.server')

    expect(getUserLookupProviderName()).toBe('nom')
    expect(logger.warn).toHaveBeenCalledWith(
      'Unknown USER_LOOKUP_PROVIDER value, falling back to default',
      expect.objectContaining({ value: 'something-invalid' }),
    )
  })

  describe('resolveUserByNavIdent', () => {
    const messages = {
      unavailable: 'unavailable-message',
      notFound: 'not-found-message',
      missingDisplayName: 'missing-display-name-message',
    }

    beforeEach(() => {
      process.env.USER_LOOKUP_PROVIDER = 'nom'
    })

    it('returns a normalized displayName and email on success', async () => {
      const { resolveUserByNavIdent } = await getModule()
      const { getNomUsersByNavIdenter } = await import('~/lib/nom.server')
      vi.mocked(getNomUsersByNavIdenter).mockResolvedValue([
        { navIdent: 'Z990001', displayName: 'Fjord, Glad', email: 'glad.fjord@nav.no' },
      ])

      const result = await resolveUserByNavIdent('Z990001', 'test-context', messages)

      expect(result).toEqual({
        ok: true,
        navIdent: 'Z990001',
        displayName: 'Glad Fjord',
        email: 'glad.fjord@nav.no',
      })
    })

    it('returns the unavailable message when the lookup throws', async () => {
      const { resolveUserByNavIdent } = await getModule()
      const { getNomUsersByNavIdenter } = await import('~/lib/nom.server')
      vi.mocked(getNomUsersByNavIdenter).mockRejectedValue(new Error('boom'))

      const result = await resolveUserByNavIdent('Z990001', 'test-context', messages)

      expect(result).toEqual({ ok: false, error: messages.unavailable })
    })

    it('returns the not-found message when no matching user is returned', async () => {
      const { resolveUserByNavIdent } = await getModule()
      const { getNomUsersByNavIdenter } = await import('~/lib/nom.server')
      vi.mocked(getNomUsersByNavIdenter).mockResolvedValue([])

      const result = await resolveUserByNavIdent('Z990001', 'test-context', messages)

      expect(result).toEqual({ ok: false, error: messages.notFound })
    })

    it('returns the missing-displayName message when the matched user has no displayName', async () => {
      const { resolveUserByNavIdent } = await getModule()
      const { getNomUsersByNavIdenter } = await import('~/lib/nom.server')
      vi.mocked(getNomUsersByNavIdenter).mockResolvedValue([{ navIdent: 'Z990001', displayName: null, email: null }])

      const result = await resolveUserByNavIdent('Z990001', 'test-context', messages)

      expect(result).toEqual({ ok: false, error: messages.missingDisplayName })
    })

    it('normalizes a lowercase/untrimmed navIdent before looking it up', async () => {
      const { resolveUserByNavIdent } = await getModule()
      const { getNomUsersByNavIdenter } = await import('~/lib/nom.server')
      vi.mocked(getNomUsersByNavIdenter).mockResolvedValue([
        { navIdent: 'Z990001', displayName: 'Fjord, Glad', email: 'glad.fjord@nav.no' },
      ])

      const result = await resolveUserByNavIdent(' z990001 ', 'test-context', messages)

      expect(getNomUsersByNavIdenter).toHaveBeenCalledWith(['Z990001'])
      expect(result).toEqual({
        ok: true,
        navIdent: 'Z990001',
        displayName: 'Glad Fjord',
        email: 'glad.fjord@nav.no',
      })
    })
  })
})
