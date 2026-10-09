import { describe, expect, it } from 'vitest'
import { stringifyForJsonbColumn } from '~/db/jsonb-sanitize.server'

describe('stringifyForJsonbColumn', () => {
  it('stringifies values without NUL bytes unchanged', () => {
    const value = { title: 'Fix bug', count: 3, tags: ['a', 'b'] }
    expect(stringifyForJsonbColumn(value)).toBe(JSON.stringify(value))
  })

  it('strips NUL bytes from a top-level string', () => {
    expect(stringifyForJsonbColumn('abc\u0000def')).toBe(JSON.stringify('abcdef'))
  })

  it('strips NUL bytes from nested object values', () => {
    const value = { title: 'bad\u0000title', body: { text: 'ok' } }
    expect(stringifyForJsonbColumn(value)).toBe(JSON.stringify({ title: 'badtitle', body: { text: 'ok' } }))
  })

  it('strips NUL bytes from array elements', () => {
    const value = ['clean', 'dir\u0000ty']
    expect(stringifyForJsonbColumn(value)).toBe(JSON.stringify(['clean', 'dirty']))
  })

  it('strips NUL bytes from strings nested inside arrays of objects', () => {
    const value = { commits: [{ message: 'ok' }, { message: 'bad\u0000message' }] }
    expect(stringifyForJsonbColumn(value)).toBe(
      JSON.stringify({ commits: [{ message: 'ok' }, { message: 'badmessage' }] }),
    )
  })

  it('leaves null and non-string primitives untouched', () => {
    const value = { a: null, b: 1, c: true, d: undefined }
    expect(stringifyForJsonbColumn(value)).toBe(JSON.stringify(value))
  })
})
