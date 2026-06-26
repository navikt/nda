import { createRequestHandler } from '@react-router/express'
import { RouterContextProvider } from 'react-router'
import { trace } from '@opentelemetry/api'
import compression from 'compression'
import express from 'express'
import path from 'node:path'
import url from 'node:url'
import winston from 'winston'
import { createAuthMiddleware } from './auth-middleware.js'
import { cspNonceContext } from './app/lib/app-context.js'
import { createSecurityHeadersMiddleware } from './app/lib/security-headers.js'

const isProd = process.env.NODE_ENV === 'production'

// Structured access logger
const accessLogger = winston.createLogger({
  level: 'info',
  format: isProd
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  transports: [new winston.transports.Console()],
})

function accessLogMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start

    // Skip static asset requests in production to reduce noise
    if (isProd && req.path.startsWith('/assets/')) return

    const span = trace.getActiveSpan()
    const traceId = span?.spanContext().traceId

    accessLogger.info('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: duration,
      trace_id: traceId,
      user_agent: req.get('user-agent'),
      remote_addr: req.ip,
    })
  })

  next()
}

const app = express()
app.disable('x-powered-by')
app.use(createSecurityHeadersMiddleware({ isProd }))
app.use(compression())

// Vite build output paths
const buildPath = path.resolve('build/server/index.js')
const buildDir = path.resolve('build/client')

// Static assets with immutable caching
app.use('/assets', express.static(path.join(buildDir, 'assets'), { immutable: true, maxAge: '1y' }))
app.use(express.static(buildDir))
app.use(express.static('public', { maxAge: '1h' }))

// Structured access logging
app.use(accessLogMiddleware)

// Authentication — all requests except health checks and M2M routes require a valid JWT
app.use(createAuthMiddleware())

// React Router request handler
const build = await import(url.pathToFileURL(buildPath).href)
app.all(
  '*',
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV,
    getLoadContext: (_req, res) => {
      // The security-headers middleware MUST run before this handler so the nonce is set.
      // Fail loudly rather than silently emitting a CSP-blocked page if that invariant breaks.
      const cspNonce = res.locals.cspNonce
      if (!cspNonce) {
        throw new Error('cspNonce missing on res.locals — security-headers middleware not registered?')
      }
      const ctx = new RouterContextProvider()
      ctx.set(cspNonceContext, cspNonce)
      return ctx
    },
  }),
)

// Express error handler — structured logging with stack_trace
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  accessLogger.error('Unhandled server error', {
    error: err.message,
    stack_trace: err.stack,
  })
  if (!res.headersSent) {
    res.status(500).send('Internal Server Error')
  }
})

const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || '0.0.0.0'

app.listen(port, host, () => {
  accessLogger.info(`Server listening on http://${host}:${port}`)
})
