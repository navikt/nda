import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import { createSecurityHeadersMiddleware } from '../security-headers'

function callMiddleware(opts: { isProd: boolean }) {
  const middleware = createSecurityHeadersMiddleware(opts)
  const headers: Record<string, string> = {}
  const locals: Record<string, unknown> = {}

  const req = { method: 'GET', url: '/' } as Request
  const res = {
    locals,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()]
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()]
    },
  } as unknown as Response

  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }

  middleware(req, res, next)
  expect(nextCalled).toBe(true)
  return { headers, locals }
}

function getDirective(csp: string, name: string): string {
  return csp.split(';').find((d) => d.trim().startsWith(`${name} `)) ?? ''
}

describe('createSecurityHeadersMiddleware', () => {
  it('sets all baseline headers in production', () => {
    const { headers } = callMiddleware({ isProd: true })
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['strict-transport-security']).toBeDefined()
    expect(headers['strict-transport-security']).toMatch(/max-age=\d+/)
    expect(headers['strict-transport-security']).toMatch(/includeSubDomains/)
    expect(headers['content-security-policy']).toBeDefined()
  })

  it('omits HSTS in development', () => {
    const { headers } = callMiddleware({ isProd: false })
    expect(headers['strict-transport-security']).toBeUndefined()
  })

  it('CSP includes the directives the app requires', () => {
    const { headers } = callMiddleware({ isProd: true })
    const csp = headers['content-security-policy']
    expect(csp).toBeDefined()

    expect(getDirective(csp, 'default-src')).toMatch(/'self'/)
    expect(getDirective(csp, 'script-src')).toMatch(/'self'/)
    expect(getDirective(csp, 'style-src')).toMatch(/'self'.*'unsafe-inline'/)
    expect(getDirective(csp, 'img-src')).toMatch(/'self'.*data:.*https:\/\/avatars\.githubusercontent\.com/)
    expect(getDirective(csp, 'font-src')).toMatch(/'self'.*data:.*https:\/\/cdn\.nav\.no/)
    expect(getDirective(csp, 'connect-src')).toMatch(/'self'/)
    expect(getDirective(csp, 'frame-ancestors')).toMatch(/'none'/)
    expect(getDirective(csp, 'base-uri')).toMatch(/'self'/)
    expect(getDirective(csp, 'form-action')).toMatch(/'self'/)
    expect(getDirective(csp, 'object-src')).toMatch(/'none'/)
  })

  it('CSP forbids inline and eval scripts (no unsafe-inline / unsafe-eval in script-src)', () => {
    const { headers } = callMiddleware({ isProd: true })
    const csp = headers['content-security-policy']
    const scriptSrc = getDirective(csp, 'script-src')
    expect(scriptSrc).not.toMatch(/'unsafe-inline'/)
    expect(scriptSrc).not.toMatch(/'unsafe-eval'/)
  })

  it('CSP includes upgrade-insecure-requests in prod, omits in dev', () => {
    const { headers: prod } = callMiddleware({ isProd: true })
    expect(prod['content-security-policy']).toMatch(/upgrade-insecure-requests/)

    const { headers: dev } = callMiddleware({ isProd: false })
    expect(dev['content-security-policy']).not.toMatch(/upgrade-insecure-requests/)
  })

  it('does not leak X-Powered-By header', () => {
    const { headers } = callMiddleware({ isProd: true })
    expect(headers['x-powered-by']).toBeUndefined()
  })

  it('generates a fresh CSP nonce per request and reflects it in the script-src directive', () => {
    const r1 = callMiddleware({ isProd: true })
    const r2 = callMiddleware({ isProd: true })

    const nonce1 = r1.locals.cspNonce as string
    const nonce2 = r2.locals.cspNonce as string

    expect(nonce1).toBeTruthy()
    expect(nonce2).toBeTruthy()
    expect(nonce1).not.toBe(nonce2)

    const scriptSrc1 = getDirective(r1.headers['content-security-policy'], 'script-src')
    const scriptSrc2 = getDirective(r2.headers['content-security-policy'], 'script-src')
    expect(scriptSrc1).toContain(`'nonce-${nonce1}'`)
    expect(scriptSrc2).toContain(`'nonce-${nonce2}'`)
    expect(scriptSrc1).not.toContain(`'nonce-${nonce2}'`)
  })

  it('CSP nonce has at least 128 bits of entropy (base64-encoded)', () => {
    const { locals } = callMiddleware({ isProd: true })
    const nonce = locals.cspNonce as string
    // 16 bytes → base64 length 24 (with padding); we accept anything >= 22
    expect(nonce.length).toBeGreaterThanOrEqual(22)
    // Must be base64-y so it's safe to embed as `'nonce-…'` in the CSP header
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})
