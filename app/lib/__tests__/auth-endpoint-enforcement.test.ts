/**
 * Per-endpoint auth enforcement tests.
 *
 * Verifies that every route in routes.ts is covered by the auth middleware:
 * - Health checks (/api/isalive, /api/isready) are explicitly public
 * - M2M routes (/api/v1/*) have self-managed auth (skipped by middleware)
 * - All other routes require a valid JWT (middleware blocks without token)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockJwtVerify = vi.fn()
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'mock-jwks'),
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}))

import type { Request, Response } from 'express'
import {
  _clearJwksCache,
  createAuthMiddleware,
  PUBLIC_PATHS,
  SELF_AUTHENTICATED_PREFIXES,
} from '../../../auth-middleware'

function mockReq(path: string, accept = 'application/json'): Request {
  return {
    path,
    originalUrl: path,
    headers: { accept, authorization: undefined },
  } as unknown as Request
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
  }
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>
    json: ReturnType<typeof vi.fn>
    redirect: ReturnType<typeof vi.fn>
  }
}

/**
 * All routes registered in app/routes.ts.
 * Each entry is a representative URL for the route pattern.
 */
const ALL_ROUTES: { path: string; description: string }[] = [
  // Health checks (should be public)
  { path: '/api/isalive', description: 'Health: isalive' },
  { path: '/api/isready', description: 'Health: isready' },

  // API routes outside layout
  { path: '/api/reports/generate', description: 'API: reports generate' },
  { path: '/api/reports/download', description: 'API: reports download' },
  { path: '/api/reports/status', description: 'API: reports status' },
  { path: '/api/search', description: 'API: search' },
  { path: '/api/checks/logs', description: 'API: check logs' },
  { path: '/api/checks/annotations', description: 'API: check annotations' },

  // M2M route (self-authenticated)
  { path: '/api/v1/apps/team/prod/myapp/verification-summary', description: 'M2M: verification summary' },
  { path: '/api/v1/apps/team/prod/myapp/audit-reports', description: 'M2M: audit reports list' },
  { path: '/api/v1/apps/team/prod/myapp/audit-reports/status', description: 'M2M: audit reports status' },
  { path: '/api/v1/apps/team/prod/myapp/audit-reports/generate', description: 'M2M: audit reports generate' },
  {
    path: '/api/v1/apps/team/prod/myapp/audit-reports/jobs/00000000-0000-0000-0000-000000000000',
    description: 'M2M: audit reports job status',
  },
  {
    path: '/api/v1/apps/team/prod/myapp/audit-reports/AUDIT-2025-myapp-abc123/download',
    description: 'M2M: audit reports download',
  },

  // Browser routes inside layout
  { path: '/', description: 'Home' },
  { path: '/my-teams', description: 'My teams' },
  { path: '/my-apps', description: 'My apps' },
  { path: '/search', description: 'Search page' },
  { path: '/team/my-team', description: 'Team overview' },
  { path: '/team/my-team/env/prod', description: 'Team environment' },
  { path: '/team/my-team/env/prod/app/my-app', description: 'App overview' },
  { path: '/team/my-team/env/prod/app/my-app/admin', description: 'App admin' },
  { path: '/team/my-team/env/prod/app/my-app/slack', description: 'App Slack' },
  { path: '/team/my-team/env/prod/app/my-app/admin/verification-diff', description: 'Verification diff' },
  { path: '/team/my-team/env/prod/app/my-app/admin/verification-diff/123', description: 'Verification diff detail' },
  { path: '/team/my-team/env/prod/app/my-app/admin/status-history', description: 'Status history' },
  { path: '/team/my-team/env/prod/app/my-app/admin/sync-job/456', description: 'Sync job detail' },
  { path: '/team/my-team/env/prod/app/my-app/deployments', description: 'App deployments' },
  { path: '/team/my-team/env/prod/app/my-app/deployments/789', description: 'Deployment detail' },
  { path: '/team/my-team/env/prod/app/my-app/deployments/789/debug-verify', description: 'Debug verify' },
  { path: '/team/my-team/env/prod/app/my-app/admin/deviations', description: 'Deviations' },
  { path: '/deployments/verify', description: 'Verify deployments' },
  { path: '/deployments/42', description: 'Deployment by ID' },
  { path: '/users/octocat', description: 'User profile' },
  { path: '/admin', description: 'Admin index' },
  { path: '/admin/users', description: 'Admin users' },
  { path: '/admin/users/export', description: 'Admin users export' },
  { path: '/admin/sync-jobs', description: 'Admin sync jobs' },
  { path: '/admin/sync-jobs/1', description: 'Admin sync job detail' },
  { path: '/admin/slack', description: 'Admin Slack' },
  { path: '/admin/audit-reports', description: 'Admin audit reports' },
  { path: '/admin/audit-reports/1/pdf', description: 'Audit report PDF' },
  { path: '/admin/audit-reports/1/view', description: 'Audit report view' },
  { path: '/admin/global-settings', description: 'Global settings' },
  { path: '/admin/application-groups', description: 'Application groups' },
  { path: '/admin/verification-diffs', description: 'Verification diffs' },
  { path: '/admin/env', description: 'Admin environment' },
  { path: '/sections', description: 'Sections' },
  { path: '/sections/my-section/edit', description: 'Section edit' },
  { path: '/sections/my-section/teams/my-team', description: 'Section team' },
  { path: '/sections/my-section/teams/my-team/boards', description: 'Section team boards' },
  { path: '/sections/my-section/teams/my-team/dashboard', description: 'Section team dashboard' },
  { path: '/sections/my-section/teams/my-team/board-1', description: 'Section team board detail' },
  { path: '/sections/my-section', description: 'Section detail' },
]

describe('per-endpoint auth enforcement', () => {
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

  const healthCheckRoutes = ALL_ROUTES.filter((r) => PUBLIC_PATHS.includes(r.path))
  const m2mRoutes = ALL_ROUTES.filter((r) => SELF_AUTHENTICATED_PREFIXES.some((p) => r.path.startsWith(p)))
  const protectedRoutes = ALL_ROUTES.filter(
    (r) => !PUBLIC_PATHS.includes(r.path) && !SELF_AUTHENTICATED_PREFIXES.some((p) => r.path.startsWith(p)),
  )

  describe('health check routes are public', () => {
    it.each(healthCheckRoutes)('$description ($path) passes through without auth', async ({ path }) => {
      const req = mockReq(path)
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
    })
  })

  describe('M2M routes are skipped (self-authenticated)', () => {
    it.each(m2mRoutes)('$description ($path) passes through without middleware auth', async ({ path }) => {
      const req = mockReq(path)
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).toHaveBeenCalledOnce()
      expect(mockJwtVerify).not.toHaveBeenCalled()
    })
  })

  describe('protected routes return 401 without token', () => {
    it.each(protectedRoutes)('$description ($path) returns 401 without token', async ({ path }) => {
      const req = mockReq(path, 'application/json')
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    })
  })

  describe('protected routes redirect browser requests without token', () => {
    it.each(protectedRoutes)('$description ($path) redirects to /oauth2/login', async ({ path }) => {
      const req = mockReq(path, 'text/html')
      const res = mockRes()
      const next = vi.fn()

      await middleware(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.redirect).toHaveBeenCalledWith(302, expect.stringContaining('/oauth2/login?redirect='))
    })
  })

  it('covers all route categories', () => {
    const totalCovered = healthCheckRoutes.length + m2mRoutes.length + protectedRoutes.length
    expect(totalCovered).toBe(ALL_ROUTES.length)
    expect(healthCheckRoutes.length).toBeGreaterThanOrEqual(2)
    expect(m2mRoutes.length).toBeGreaterThanOrEqual(1)
    expect(protectedRoutes.length).toBeGreaterThanOrEqual(30)
  })
})
