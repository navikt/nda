import { PassThrough } from 'node:stream'
import { createReadableStreamFromReadable } from '@react-router/node'
import { isbot } from 'isbot'
import type { RenderToPipeableStreamOptions } from 'react-dom/server'
import { renderToPipeableStream } from 'react-dom/server'
import type { AppLoadContext, EntryContext } from 'react-router'
import { ServerRouter } from 'react-router'
import './load-context'
import { initializeServer } from './init.server'
import { logger } from './lib/logger.server'

const originalConsoleError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  const error = args.find((arg): arg is Error => arg instanceof Error)
  if (error) {
    const prefixParts = args.filter((arg) => arg !== error && typeof arg === 'string')
    const message = prefixParts.length > 0 ? prefixParts.join(' ') : error.message
    logger.error(message, error)
    return
  }

  const message = args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ')
  if (message.trim()) {
    originalConsoleError(message)
  }
}

initializeServer()

export const streamTimeout = 5_000

export function handleError(error: unknown, { request }: { request: Request }) {
  if (error instanceof Error && /aborted/i.test(error.message)) return

  const url = new URL(request.url)
  if (error instanceof Error) {
    logger.error(`Request error: ${error.message}`, {
      stack_trace: error.stack,
      url: url.pathname,
      method: request.method,
    })
  } else {
    logger.error(`Request error: ${String(error)}`, {
      url: url.pathname,
      method: request.method,
    })
  }
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
) {
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    })
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false
    const userAgent = request.headers.get('user-agent')

    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady'

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000)

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={loadContext.cspNonce} />,
      {
        nonce: loadContext.cspNonce,
        [readyOption]() {
          shellRendered = true
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId)
              timeoutId = undefined
              callback()
            },
          })
          const stream = createReadableStreamFromReadable(body)

          responseHeaders.set('Content-Type', 'text/html')

          pipe(body)

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          )
        },
        onShellError(error: unknown) {
          reject(error)
        },
        onError(error: unknown) {
          responseStatusCode = 500
          if (shellRendered) {
            logger.error('Stream rendering error', error instanceof Error ? error : undefined)
          }
        },
      },
    )
  })
}
