import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock jose before importing the middleware
const mockJwtVerify = vi.fn()
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}))

import {
  _clearJwksCache,
  createAuthMiddleware,
  PUBLIC_PATHS,
  SELF_AUTHENTICATED_PREFIXES,
} from '../../../auth-middleware'

/** Helper to create a mock Express request */
function mockReq(overrides: { path?: string; originalUrl?: string; accept?: string; authorization?: string } = {}) {
  return {
    path: overrides.path ?? '/',
    originalUrl: overrides.originalUrl ?? overrides.path ?? '/',
    headers: {
      accept: overrides.accept ?? 'text/html',
      authorization: overrides.authorization,
    },
  } as import('express').Request
}

/** Helper to create a mock Express response */
function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
  }
  return res as unknown as import('express').Response & {
    status: ReturnType<typeof vi.fn>
    json: ReturnType<typeof vi.fn>
    redirect: ReturnType<typeof vi.fn>
  }
}

describe('createAuthMiddleware', () => {
  const originalEnv = { ...process.env }
  let middleware: ReturnType<typeof createAuthMiddleware>

  beforeEach(() => {
    vi.clearAllMocks()
    _clearJwksCache()
    process.env.AZURE_OPENID_CONFIG_JWKS_URI = 'https://login.microsoftonline.com/jwks'
    process.env.AZURE_OPENID_CONFIG_ISSUER = 'https://login.microsoftonline.com/tenant/v2.0'
    process.env.AZURE_APP_CLIENT_ID = 'test-client-id'
    process.env.NAIS_CLUSTER_NAME = 'prod-gcp'
    process.env.NODE_ENV = 'production'
    middleware = createAuthMiddleware()
  })

  afterEach(() => {
    process.env.AZURE_OPENID_CONFIG_JWKS_URI = originalEnv.AZURE_OPENID_CONFIG_JWKS_URI
    process.env.AZURE_OPENID_CONFIG_ISSUER = originalEnv.AZURE_OPENID_CONFIG_ISSUER
    process.env.AZURE_APP_CLIENT_ID = originalEnv.AZURE_APP_CLIENT_ID
    process.env.NAIS_CLUSTER_NAME = originalEnv.NAIS_CLUSTER_NAME
    process.env.NODE_ENV = originalEnv.NODE_ENV
  })

  describe('public paths (health checks)', () => {
    it('passes /api/isalive through without auth', async () => {
      const req = mockReq({ path: '/api/isalive' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(res.status).not.toHaveBeenCalled()
      expect(res.redirect).not.toHaveBeenCalled()
    })

    it('passes /api/isready through without auth', async () => {
      const req = mockReq({ path: '/api/isready' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
    })
  })

  describe('self-authenticated paths (M2M)', () => {
    it('passes /api/v1/ routes through without middleware auth', async () => {
      const req = mockReq({ path: '/api/v1/apps/team/env/app/verification-summary' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })
  })

  describe('development mode bypass', () => {
    it('skips auth in development without NAIS cluster', async () => {
      process.env.NODE_ENV = 'development'
      delete process.env.NAIS_CLUSTER_NAME
      middleware = createAuthMiddleware()

      const req = mockReq({ path: '/dashboard' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
    })

    it('does NOT skip auth in development WITH NAIS cluster', async () => {
      process.env.NODE_ENV = 'development'
      process.env.NAIS_CLUSTER_NAME = 'dev-gcp'
      middleware = createAuthMiddleware()

      const req = mockReq({ path: '/dashboard', accept: 'application/json' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })
  })

  describe('missing configuration', () => {
    it('denies access when JWKS URI is missing', async () => {
      delete process.env.AZURE_OPENID_CONFIG_JWKS_URI
      middleware = createAuthMiddleware()

      const req = mockReq({ path: '/some-page', accept: 'application/json' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('denies access when issuer is missing', async () => {
      delete process.env.AZURE_OPENID_CONFIG_ISSUER
      middleware = createAuthMiddleware()

      const req = mockReq({ path: '/some-page', accept: 'application/json' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('denies access when client ID is missing', async () => {
      delete process.env.AZURE_APP_CLIENT_ID
      middleware = createAuthMiddleware()

      const req = mockReq({ path: '/some-page', accept: 'application/json' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })
  })

  describe('token extraction', () => {
    it('denies access when Authorization header is missing', async () => {
      const req = mockReq({ path: '/dashboard', accept: 'application/json' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('denies access when Authorization header is not Bearer', async () => {
      const req = mockReq({ path: '/dashboard', accept: 'application/json', authorization: 'Basic abc123' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('accepts case-insensitive Bearer prefix', async () => {
      mockJwtVerify.mockResolvedValue({ payload: {} })

      const req = mockReq({ path: '/dashboard', authorization: 'bearer valid-token' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(mockJwtVerify).toHaveBeenCalledWith('valid-token', 'mock-jwks', {
        issuer: 'https://login.microsoftonline.com/tenant/v2.0',
        audience: 'test-client-id',
      })
    })
  })

  describe('valid token', () => {
    it('calls next() when JWT verification succeeds with user token', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { sub: 'user', NAVident: 'Z990001' } })

      const req = mockReq({ path: '/dashboard', authorization: 'Bearer valid-token' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(res.status).not.toHaveBeenCalled()
      expect(res.redirect).not.toHaveBeenCalled()
    })

    it('validates with correct issuer and audience', async () => {
      mockJwtVerify.mockResolvedValue({ payload: {} })

      const req = mockReq({ path: '/dashboard', authorization: 'Bearer my-token' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(mockJwtVerify).toHaveBeenCalledWith('my-token', 'mock-jwks', {
        issuer: 'https://login.microsoftonline.com/tenant/v2.0',
        audience: 'test-client-id',
      })
    })
  })

  describe('M2M app tokens rejected on non-M2M routes', () => {
    it('rejects tokens with idtyp=app on browser routes', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { idtyp: 'app', aud: 'test-client-id' } })

      const req = mockReq({ path: '/dashboard', accept: 'application/json', authorization: 'Bearer app-token' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('rejects tokens with idtyp=app on API routes outside M2M prefix', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { idtyp: 'app' } })

      const req = mockReq({ path: '/api/search', accept: 'application/json', authorization: 'Bearer app-token' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('allows tokens without idtyp (user tokens)', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { NAVident: 'Z990001' } })

      const req = mockReq({ path: '/dashboard', authorization: 'Bearer user-token' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
    })
  })

  describe('invalid token — browser requests (Accept: text/html)', () => {
    it('redirects to /oauth2/login with redirect param', async () => {
      mockJwtVerify.mockRejectedValue(new Error('invalid'))

      const req = mockReq({
        path: '/dashboard',
        originalUrl: '/dashboard?tab=1',
        accept: 'text/html',
        authorization: 'Bearer bad-token',
      })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.redirect).toHaveBeenCalledWith(302, '/oauth2/login?redirect=%2Fdashboard%3Ftab%3D1')
    })

    it('redirects when token is missing for browser request', async () => {
      const req = mockReq({ path: '/', accept: 'text/html' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.redirect).toHaveBeenCalledWith(302, '/oauth2/login?redirect=%2F')
    })

    it('encodes complex URLs in redirect param', async () => {
      const req = mockReq({
        path: '/team/my-team/env/prod',
        originalUrl: '/team/my-team/env/prod?a=1&b=2',
        accept: 'text/html',
      })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/oauth2/login?redirect=%2Fteam%2Fmy-team%2Fenv%2Fprod%3Fa%3D1%26b%3D2',
      )
    })
  })

  describe('invalid token — API requests (Accept: application/json)', () => {
    it('returns 401 JSON for API requests with bad token', async () => {
      mockJwtVerify.mockRejectedValue(new Error('expired'))

      const req = mockReq({ path: '/api/search', accept: 'application/json', authorization: 'Bearer expired-token' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })

    it('returns 401 for API requests without token', async () => {
      const req = mockReq({ path: '/api/search', accept: 'application/json' })
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })
  })

  describe('exported constants', () => {
    it('PUBLIC_PATHS includes health checks', () => {
      expect(PUBLIC_PATHS).toContain('/api/isalive')
      expect(PUBLIC_PATHS).toContain('/api/isready')
    })

    it('SELF_AUTHENTICATED_PREFIXES includes M2M routes', () => {
      expect(SELF_AUTHENTICATED_PREFIXES).toContain('/api/v1/')
    })
  })
})
