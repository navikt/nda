import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn() },
  fetchWithLogging: async (_area: string, url: string | URL, options?: RequestInit) => fetch(url, options),
  logOutgoingHttp: vi.fn(),
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

  async function getBatchFn() {
    const mod = await import('../microsoft-graph.server')
    return mod.getGraphUsersByNavIdenter
  }

  it('searches by NAV-ident using $filter with onPremisesSamAccountName', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockGraphResponse([
          {
            displayName: 'Glad Fjord',
            onPremisesSamAccountName: 'Z990001',
            mail: 'glad.fjord@nav.no',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    const results = await searchGraphUsers('Z990001')

    expect(results).toEqual([{ displayName: 'Glad Fjord', navIdent: 'Z990001', email: 'glad.fjord@nav.no' }])

    const graphCall = fetchMock.mock.calls[1]
    const url = graphCall[0] as string
    expect(url).toContain('$filter=')
    expect(url).toContain(encodeURIComponent("onPremisesSamAccountName eq 'Z990001'"))
    expect(url).toContain('$count=true')
    expect(url).not.toContain('$search')
  })

  it('searches by display name using $search with displayName:', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockGraphResponse([
          {
            displayName: 'Stille Skog',
            onPremisesSamAccountName: 'Z990003',
            mail: null,
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    const results = await searchGraphUsers('Stille')

    expect(results).toEqual([{ displayName: 'Stille Skog', navIdent: 'Z990003', email: null }])

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
    await searchGraphUsers('Glad "Fjord\\ test')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const url = decodeURIComponent(fetchMock.mock.calls[1][0] as string)
    expect(url).toContain('"displayName:Glad"')
    expect(url).toContain('"displayName:Fjord"')
    expect(url).toContain('"displayName:test"')
  })

  it('uses implicit AND for multi-word name searches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockGraphResponse([
          {
            displayName: 'Røe, Modig',
            onPremisesSamAccountName: 'Z990004',
            mail: null,
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const searchGraphUsers = await getSearchFn()
    const results = await searchGraphUsers('Modig Røe')

    expect(results).toEqual([{ displayName: 'Røe, Modig', navIdent: 'Z990004', email: null }])

    const url = decodeURIComponent(fetchMock.mock.calls[1][0] as string)
    expect(url).toContain('"displayName:Modig"')
    expect(url).toContain('"displayName:Røe"')
    expect(url).toContain('$top=10')
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

  describe('getGraphUsersByNavIdenter', () => {
    it('returns empty array for an empty list without calling the token endpoint', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const getGraphUsersByNavIdenter = await getBatchFn()
      const results = await getGraphUsersByNavIdenter([])

      expect(results).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('builds an OR filter across the given NAV-idents in a single batch', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(
          mockGraphResponse([
            { displayName: 'Glad Fjord', onPremisesSamAccountName: 'Z990001', mail: 'glad.fjord@nav.no' },
            { displayName: 'Rask Elv', onPremisesSamAccountName: 'Z990002', mail: 'rask.elv@nav.no' },
          ]),
        )
      vi.stubGlobal('fetch', fetchMock)

      const getGraphUsersByNavIdenter = await getBatchFn()
      const results = await getGraphUsersByNavIdenter(['Z990001', 'Z990002'])

      expect(results).toEqual([
        { displayName: 'Glad Fjord', navIdent: 'Z990001', email: 'glad.fjord@nav.no' },
        { displayName: 'Rask Elv', navIdent: 'Z990002', email: 'rask.elv@nav.no' },
      ])

      const url = decodeURIComponent(fetchMock.mock.calls[1][0] as string)
      expect(url).toContain("onPremisesSamAccountName eq 'Z990001'")
      expect(url).toContain("onPremisesSamAccountName eq 'Z990002'")
      expect(url).toContain(' or ')
      expect(url).toContain('$top=2')
    })

    it('splits the request into multiple batches when exceeding the batch size', async () => {
      const navIdenter = Array.from({ length: 16 }, (_, i) => `Z9900${i.toString().padStart(2, '0')}`)
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockGraphResponse([]))
        .mockResolvedValueOnce(mockGraphResponse([]))
      vi.stubGlobal('fetch', fetchMock)

      const getGraphUsersByNavIdenter = await getBatchFn()
      await getGraphUsersByNavIdenter(navIdenter)

      expect(fetchMock).toHaveBeenCalledTimes(3)
      const firstBatchUrl = decodeURIComponent(fetchMock.mock.calls[1][0] as string)
      const secondBatchUrl = decodeURIComponent(fetchMock.mock.calls[2][0] as string)
      expect(firstBatchUrl).toContain('$top=15')
      expect(secondBatchUrl).toContain('$top=1')
    })

    it('throws when Graph API returns an error', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      vi.stubGlobal('fetch', fetchMock)

      const getGraphUsersByNavIdenter = await getBatchFn()
      await expect(getGraphUsersByNavIdenter(['Z990001'])).rejects.toThrow('Graph API search failed: 403')
    })
  })
})
