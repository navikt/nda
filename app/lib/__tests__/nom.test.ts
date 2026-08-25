import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn() },
  fetchWithLogging: async (_area: string, url: string | URL, options?: RequestInit) => fetch(url, options),
  logOutgoingHttp: vi.fn(),
}))

describe('nom.server', () => {
  const originalTokenEndpoint = process.env.NAIS_TOKEN_ENDPOINT
  const originalScope = process.env.NOM_API_SCOPE
  const originalApiUrl = process.env.NOM_API_URL

  beforeEach(() => {
    process.env.NAIS_TOKEN_ENDPOINT = 'http://token-endpoint/token'
    process.env.NOM_API_SCOPE = 'api://cluster.nom.nom-api-graphql/.default'
    process.env.NOM_API_URL = 'http://nom-api-graphql/graphql'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    restoreEnv('NAIS_TOKEN_ENDPOINT', originalTokenEndpoint)
    restoreEnv('NOM_API_SCOPE', originalScope)
    restoreEnv('NOM_API_URL', originalApiUrl)
    vi.resetModules()
    vi.restoreAllMocks()
  })

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }

  function mockTokenResponse() {
    return Response.json({ access_token: 'test-token', expires_in: 3600 })
  }

  function mockRessurserResponse(ressurser: Array<Record<string, string | null> | null>) {
    return Response.json({ data: { ressurser: ressurser.map((ressurs) => ({ ressurs })) } })
  }

  function mockSearchRessursResponse(ressurser: Array<Record<string, string | null>>) {
    return Response.json({ data: { searchRessurs: ressurser } })
  }

  async function getModule() {
    return import('../nom.server')
  }

  it('fetches users by NAV-ident via the ressurser query', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockRessurserResponse([
          {
            navident: 'Z990001',
            epost: 'glad.fjord@nav.no',
            visningsnavn: 'Fjord, Glad',
          },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { getNomUsersByNavIdenter } = await getModule()
    const results = await getNomUsersByNavIdenter(['Z990001'])

    expect(results).toEqual([{ displayName: 'Fjord, Glad', navIdent: 'Z990001', email: 'glad.fjord@nav.no' }])

    const [tokenCall, apiCall] = fetchMock.mock.calls
    const tokenBody = tokenCall[1]?.body as string
    expect(tokenBody.includes('api://cluster.nom.nom-api-graphql/.default')).toBe(true)
    const body = JSON.parse(apiCall[1]?.body as string)
    expect(body.variables).toEqual({ navIdenter: ['Z990001'] })
  })

  it('filters out missing ressurs entries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(mockRessurserResponse([null]))
    vi.stubGlobal('fetch', fetchMock)

    const { getNomUsersByNavIdenter } = await getModule()
    const results = await getNomUsersByNavIdenter(['Z990002'])

    expect(results).toEqual([])
  })

  it('returns empty array without calling the API for an empty nav-ident list', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { getNomUsersByNavIdenter } = await getModule()
    const results = await getNomUsersByNavIdenter([])

    expect(results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searches by NAV-ident using getNomUsersByNavIdenter under the hood', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockRessurserResponse([{ navident: 'Z990003', epost: null, visningsnavn: 'Skog, Stille' }]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { searchNomUsers } = await getModule()
    const results = await searchNomUsers('z990003')

    expect(results).toEqual([{ displayName: 'Skog, Stille', navIdent: 'Z990003', email: null }])

    const apiCall = fetchMock.mock.calls[1]
    const body = JSON.parse(apiCall[1]?.body as string)
    expect(body.query).toContain('HentRessurser')
    expect(body.variables).toEqual({ navIdenter: ['Z990003'] })
  })

  it('searches by free text using the searchRessurs query', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(
        mockSearchRessursResponse([{ navident: 'Z990004', epost: null, visningsnavn: 'Røe, Modig' }]),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { searchNomUsers } = await getModule()
    const results = await searchNomUsers('Modig Røe')

    expect(results).toEqual([{ displayName: 'Røe, Modig', navIdent: 'Z990004', email: null }])

    const apiCall = fetchMock.mock.calls[1]
    const body = JSON.parse(apiCall[1]?.body as string)
    expect(body.query).toContain('SearchRessurs')
    expect(body.variables).toEqual({ term: 'Modig Røe' })
  })

  it('returns empty array for empty or blank search query', async () => {
    const { searchNomUsers } = await getModule()

    expect(await searchNomUsers('')).toEqual([])
    expect(await searchNomUsers(' ')).toEqual([])
  })

  it('throws when NAIS_TOKEN_ENDPOINT is not configured', async () => {
    delete process.env.NAIS_TOKEN_ENDPOINT
    const { searchNomUsers } = await getModule()
    await expect(searchNomUsers('test')).rejects.toThrow('NAIS_TOKEN_ENDPOINT is not configured')
  })

  it('throws when NOM_API_SCOPE is not configured', async () => {
    delete process.env.NOM_API_SCOPE
    const { searchNomUsers } = await getModule()
    await expect(searchNomUsers('test')).rejects.toThrow('NOM_API_SCOPE is not configured')
  })

  it('throws when NOM_API_URL is not configured', async () => {
    delete process.env.NOM_API_URL
    const fetchMock = vi.fn().mockResolvedValueOnce(mockTokenResponse())
    vi.stubGlobal('fetch', fetchMock)

    const { searchNomUsers } = await getModule()
    await expect(searchNomUsers('test')).rejects.toThrow('NOM_API_URL is not configured')
  })

  it('throws when the NOM API returns a non-ok response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const { searchNomUsers } = await getModule()
    await expect(searchNomUsers('test')).rejects.toThrow('NOM API request failed: 403 - Forbidden')
  })

  it('throws when the NOM API returns GraphQL errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockTokenResponse())
      .mockResolvedValueOnce(Response.json({ errors: [{ message: 'boom' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const { searchNomUsers } = await getModule()
    await expect(searchNomUsers('test')).rejects.toThrow('NOM API returned errors: boom')
  })

  it('includes the response body in the error when token acquisition fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_target', error_description: 'Unknown scope' }), {
        status: 400,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { searchNomUsers } = await getModule()
    await expect(searchNomUsers('test')).rejects.toThrow(
      'Token acquisition failed: 400 - {"error":"invalid_target","error_description":"Unknown scope"}',
    )

    const { logger } = await import('~/lib/logger.server')
    expect(logger.error).toHaveBeenCalledWith('Failed to acquire NOM token', {
      status: 400,
      body: '{"error":"invalid_target","error_description":"Unknown scope"}',
    })
  })

  it('omits the trailing dash when the error response body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const { searchNomUsers } = await getModule()

    try {
      await searchNomUsers('test')
      throw new Error('expected searchNomUsers to throw')
    } catch (error) {
      expect((error as Error).message).toBe('Token acquisition failed: 500')
    }
  })
})
