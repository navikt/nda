import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/logger.server', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { requireM2MToken } from '../m2m-auth.server'

function makeRequest(authHeader?: string): Request {
  const headers = new Headers()
  if (authHeader) {
    headers.set('Authorization', authHeader)
  }
  return new Request('http://localhost/api/v1/test', { headers })
}

describe('requireM2MToken', () => {
  const originalEnv = process.env.NAIS_TOKEN_INTROSPECTION_ENDPOINT
  const originalClientId = process.env.AZURE_APP_CLIENT_ID
  const EXPECTED_AUDIENCE = 'deployment-audit-client-id'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NAIS_TOKEN_INTROSPECTION_ENDPOINT = 'http://localhost:1234/introspect'
    process.env.AZURE_APP_CLIENT_ID = EXPECTED_AUDIENCE
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalEnv !== undefined) {
      process.env.NAIS_TOKEN_INTROSPECTION_ENDPOINT = originalEnv
    } else {
      delete process.env.NAIS_TOKEN_INTROSPECTION_ENDPOINT
    }
    if (originalClientId !== undefined) {
      process.env.AZURE_APP_CLIENT_ID = originalClientId
    } else {
      delete process.env.AZURE_APP_CLIENT_ID
    }
  })

  it('throws 401 when Authorization header is missing', async () => {
    const request = makeRequest()
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(Response)
      const response = e as Response
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toContain('Missing or invalid Authorization header')
    }
  })

  it('throws 401 when Authorization header is not Bearer', async () => {
    const request = makeRequest('Basic dXNlcjpwYXNz')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
    }
  })

  it('throws 401 when introspection endpoint is not configured', async () => {
    delete process.env.NAIS_TOKEN_INTROSPECTION_ENDPOINT
    const request = makeRequest('Bearer valid-token')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toContain('Token validation unavailable')
    }
  })

  it('throws 401 when token is inactive', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ active: false, error: 'token is expired' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const request = makeRequest('Bearer expired-token')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Invalid token')
    }
  })

  it('throws 403 when token lacks access_as_application role', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'some-client-id',
          azp_name: 'some-app',
          idtyp: 'app',
          roles: ['some-other-role'],
          sub: 'sub-id',
          tid: 'tenant-id',
          iss: 'issuer',
          aud: EXPECTED_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('Bearer valid-token-wrong-role')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error).toBe('Insufficient permissions')
    }
  })

  it('returns payload when token is valid with access_as_application role', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'kiss-client-id',
          azp_name: 'kiss',
          idtyp: 'app',
          roles: ['access_as_application'],
          sub: 'sub-id',
          tid: 'tenant-id',
          iss: 'issuer',
          aud: EXPECTED_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('Bearer valid-m2m-token')
    const result = await requireM2MToken(request)

    expect(result.azp).toBe('kiss-client-id')
    expect(result.azpName).toBe('kiss')
    expect(result.roles).toContain('access_as_application')
  })

  it('sends correct introspection request', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'client-id',
          idtyp: 'app',
          roles: ['access_as_application'],
          sub: 'sub',
          tid: 'tid',
          iss: 'iss',
          aud: EXPECTED_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('Bearer my-test-token')
    await requireM2MToken(request)

    expect(fetchSpy).toHaveBeenCalledWith('http://localhost:1234/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity_provider: 'entra_id',
        token: 'my-test-token',
      }),
    })
  })

  it('throws 401 when introspection endpoint returns non-200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

    const request = makeRequest('Bearer some-token')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
    }
  })

  it('throws 401 when fetch itself fails (network error)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const request = makeRequest('Bearer some-token')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
    }
  })

  it('handles token with no roles array', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'client-id',
          idtyp: 'app',
          sub: 'sub',
          tid: 'tid',
          iss: 'iss',
          aud: EXPECTED_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('Bearer token-no-roles')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(403)
    }
  })

  it('throws 401 when token audience does not match AZURE_APP_CLIENT_ID', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'kiss-client-id',
          azp_name: 'kiss',
          roles: ['access_as_application'],
          sub: 'sub-id',
          tid: 'tenant-id',
          iss: 'issuer',
          aud: 'wrong-audience',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('Bearer valid-token-wrong-aud')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Invalid token')
    }
  })

  it('throws 401 when AZURE_APP_CLIENT_ID is not configured', async () => {
    delete process.env.AZURE_APP_CLIENT_ID

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'kiss-client-id',
          roles: ['access_as_application'],
          sub: 'sub',
          tid: 'tid',
          iss: 'iss',
          aud: 'some-audience',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('Bearer valid-token')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
    }
  })

  it('throws 401 when token identity type is not app', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'some-client-id',
          idtyp: 'user',
          roles: ['access_as_application'],
          sub: 'sub-id',
          tid: 'tenant-id',
          iss: 'issuer',
          aud: EXPECTED_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('Bearer user-token')
    try {
      await requireM2MToken(request)
      expect.unreachable('Should have thrown')
    } catch (e) {
      const response = e as Response
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error).toBe('Invalid token')
    }
  })

  it('accepts lowercase bearer scheme', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          azp: 'kiss-client-id',
          azp_name: 'kiss',
          idtyp: 'app',
          roles: ['access_as_application'],
          sub: 'sub-id',
          tid: 'tenant-id',
          iss: 'issuer',
          aud: EXPECTED_AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          ver: '2.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const request = makeRequest('bearer my-token')
    const result = await requireM2MToken(request)
    expect(result.azp).toBe('kiss-client-id')
  })
})
