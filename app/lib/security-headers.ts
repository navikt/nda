import crypto from 'node:crypto'
import type express from 'express'
import helmet from 'helmet'

declare module 'express-serve-static-core' {
  interface Locals {
    cspNonce?: string
  }
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64')
}

export function createSecurityHeadersMiddleware(opts: { isProd: boolean }): express.RequestHandler {
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (_req, res) => `'nonce-${(res as express.Response).locals.cspNonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:', 'https://cdn.nav.no'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: opts.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: opts.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
  })

  return function securityHeaders(req, res, next) {
    res.locals.cspNonce = generateNonce()
    helmetMiddleware(req, res, next)
  }
}
