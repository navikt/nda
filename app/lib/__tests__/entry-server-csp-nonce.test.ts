import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('entry.server.tsx CSP nonce wiring', () => {
  const entryServerPath = path.resolve(__dirname, '../../entry.server.tsx')
  const source = readFileSync(entryServerPath, 'utf-8')

  it('reads the CSP nonce from the x-csp-nonce request header', () => {
    expect(
      /request\.headers\.get\(['"]x-csp-nonce['"]\)/.test(source),
      'entry.server.tsx must read the nonce from request.headers.get("x-csp-nonce") — the Express middleware sets this header so the nonce is available without loadContext.',
    ).toBe(true)
  })

  it('passes the nonce to renderToPipeableStream so React-emitted inline scripts get a nonce', () => {
    expect(/renderToPipeableStream/.test(source), 'renderToPipeableStream call not found in entry.server.tsx').toBe(
      true,
    )

    expect(
      /renderToPipeableStream[\s\S]*?\{\s*\n\s*nonce[,\s]/.test(source),
      'renderToPipeableStream options must include `nonce` as the first property so React DOM stamps its streaming inline scripts with the CSP nonce. Without it, browsers will block the Suspense boundary runtime.',
    ).toBe(true)
  })

  it('still passes nonce to <ServerRouter> for React Router-emitted scripts', () => {
    expect(
      /<ServerRouter[\s\S]*nonce=\{nonce\}/.test(source),
      "<ServerRouter nonce={nonce} /> is required so React Router's own inline scripts (context + manifest) carry the nonce.",
    ).toBe(true)
  })
})
