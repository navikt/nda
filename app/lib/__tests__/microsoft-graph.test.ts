import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger before importing the module under test
vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn() },
}))

describe('microsoft-graph', () => {
  const originalEnv = process.env.NAIS_TOKEN_ENDPOINT

  beforeEach(() => {
    process.env.NAIS_TOKEN_ENDPOINT = 'http://token-endpoint/token'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NAIS_TOKEN_ENDPOINT
    } else {
      process.env.NAIS_TOKEN_ENDPOINT = originalEnv
    }
    vi.resetModules()
    vi.restoreAllMocks()
  })

  function mockTokenResponse() {
    return Response.json({ access_token: 'test-token', expires_in: 3600 })
  }

  function mockGraphResponse(users: Array<Record<string, string | null>>) {
    return Response.json({ value: users })
  }

  async function getSearchFn() {
    const mod = await import('../microsoft-graph.server')
    return mod.searchGraphUsers
  }

  it('searches by NAV-ident using $filter with onPremisesSamAccountName', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockGraphResponse([
          {
            displayName: 'Glad Fjord',
            mail: 'glad.fjord@nav.no',
            onPremisesSamAccountName: 'A123456',
            userPrincipalName: 'glad.fjord@nav.no',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    const results = await searchGraphUsers('A123456')

    expect(results).toEqual([{ displayName: 'Glad Fjord', email: 'glad.fjord@nav.no', navIdent: 'A123456' }])

    const graphCall = fetchMock.mock.calls[1]
    const url = graphCall[0] as string
    expect(url).toContain('$filter=')
    expect(url).toContain(encodeURIComponent("onPremisesSamAccountName eq 'A123456'"))
    expect(url).not.toContain('$search')
  })

  it('searches by email using $search with mail:', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockGraphResponse([
          {
            displayName: 'Rask Elv',
            mail: 'rask.elv@nav.no',
            onPremisesSamAccountName: 'B654321',
            userPrincipalName: 'rask.elv@nav.no',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    const results = await searchGraphUsers('rask.elv@nav.no')

    expect(results).toEqual([{ displayName: 'Rask Elv', email: 'rask.elv@nav.no', navIdent: 'B654321' }])

    const graphCall = fetchMock.mock.calls[1]
    const url = graphCall[0] as string
    expect(url).toContain('$search=')
    expect(url).toContain(encodeURIComponent('"mail:rask.elv@nav.no"'))
    expect(url).toContain('$count=true')
  })

  it('searches by display name using $search with displayName:', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockGraphResponse([
          {
            displayName: 'Stille Skog',
            mail: 'stille.skog@nav.no',
            onPremisesSamAccountName: 'C111222',
            userPrincipalName: 'stille.skog@nav.no',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    const results = await searchGraphUsers('Stille')

    expect(results).toEqual([{ displayName: 'Stille Skog', email: 'stille.skog@nav.no', navIdent: 'C111222' }])

    const graphCall = fetchMock.mock.calls[1]
    const url = graphCall[0] as string
    expect(url).toContain('$search=')
    expect(url).toContain(encodeURIComponent('"displayName:Stille"'))
    expect(url).toContain('$count=true')
  })

  it('strips quotes and backslashes from search values', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockGraphResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    await searchGraphUsers('Ola "Nordmann\\ test')

    const graphCall = fetchMock.mock.calls[1]
    const url = graphCall[0] as string
    // Quotes and backslashes are stripped, words combined with OR
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('"displayName:Ola"')
    expect(decoded).toContain('"displayName:Nordmann"')
    expect(decoded).toContain('"displayName:test"')
    expect(decoded).toContain(' OR ')
  })

  it('filters multi-word results to only users matching all words', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockGraphResponse([
          {
            displayName: 'Modig Bjørk',
            mail: 'modig.bjork@nav.no',
            onPremisesSamAccountName: 'D111222',
            userPrincipalName: 'modig.bjork@nav.no',
          },
          {
            displayName: 'Modig Elv',
            mail: 'modig.elv@nav.no',
            onPremisesSamAccountName: 'E333444',
            userPrincipalName: 'modig.elv@nav.no',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    const results = await searchGraphUsers('Modig Bjørk')

    // Only the user matching both words should be returned
    expect(results).toEqual([{ displayName: 'Modig Bjørk', email: 'modig.bjork@nav.no', navIdent: 'D111222' }])
  })

  it('returns empty array for empty or short query', async () => {
    const searchGraphUsers = await getSearchFn()

    expect(await searchGraphUsers('')).toEqual([])
    expect(await searchGraphUsers(' ')).toEqual([])
  })

  it('throws when NAIS_TOKEN_ENDPOINT is not configured', async () => {
    delete process.env.NAIS_TOKEN_ENDPOINT
    const searchGraphUsers = await getSearchFn()
    await expect(searchGraphUsers('test')).rejects.toThrow('NAIS_TOKEN_ENDPOINT is not configured')
  })

  it('throws when Graph API returns an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    await expect(searchGraphUsers('test')).rejects.toThrow('Graph API search failed: 403')
  })

  it('uses ConsistencyLevel: eventual header', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(mockTokenResponse()).mockResolvedValueOnce(mockGraphResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    await searchGraphUsers('test name')

    const graphCall = fetchMock.mock.calls[1]
    const headers = graphCall[1]?.headers as Record<string, string>
    expect(headers.ConsistencyLevel).toBe('eventual')
    expect(headers.Authorization).toBe('Bearer test-token')
  })
})
