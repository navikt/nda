import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('entry.server.tsx CSP nonce wiring', () => {
  const entryServerPath = path.resolve(__dirname, '../../entry.server.tsx')
  const source = readFileSync(entryServerPath, 'utf-8')

  it('passes loadContext.cspNonce to renderToPipeableStream so React-emitted inline scripts get a nonce', () => {
    expect(/renderToPipeableStream/.test(source), 'renderToPipeableStream call not found in entry.server.tsx').toBe(
      true,
    )

    expect(
      /\bnonce\s*:\s*loadContext\.cspNonce\b/.test(source),
      'renderToPipeableStream options must include `nonce: loadContext.cspNonce` so React DOM stamps its streaming inline scripts with the CSP nonce. Without it, browsers will block the Suspense boundary runtime.',
    ).toBe(true)
  })

  it('still passes nonce to <ServerRouter> for React Router-emitted scripts', () => {
    expect(
      /<ServerRouter[\s\S]*nonce=\{loadContext\.cspNonce\}/.test(source),
      '<ServerRouter nonce={loadContext.cspNonce} /> is required so React Router’s own inline scripts (context + manifest) carry the nonce.',
    ).toBe(true)
  })
})
