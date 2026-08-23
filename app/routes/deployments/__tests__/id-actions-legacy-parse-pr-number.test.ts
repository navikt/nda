import { describe, expect, test } from 'vitest'
import { parsePrNumber } from '../$id.actions.legacy.server'

describe('parsePrNumber', () => {
  test('returns null value for empty/undefined/null input', () => {
    expect(parsePrNumber('')).toEqual({ value: null })
    expect(parsePrNumber('   ')).toEqual({ value: null })
    expect(parsePrNumber(undefined)).toEqual({ value: null })
    expect(parsePrNumber(null)).toEqual({ value: null })
  })

  test('parses a valid positive integer string', () => {
    expect(parsePrNumber('123')).toEqual({ value: 123 })
    expect(parsePrNumber('  456  ')).toEqual({ value: 456 })
  })

  test('rejects non-numeric input with an error, not NaN', () => {
    const result = parsePrNumber('abc')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects negative numbers', () => {
    const result = parsePrNumber('-1')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects zero', () => {
    const result = parsePrNumber('0')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects non-integer decimal numbers', () => {
    const result = parsePrNumber('12.5')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects scientific notation', () => {
    const result = parsePrNumber('1e2')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects hexadecimal notation', () => {
    const result = parsePrNumber('0x10')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects a whole number written as a decimal', () => {
    const result = parsePrNumber('1.0')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects a positive sign prefix', () => {
    const result = parsePrNumber('+12')
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('accepts a plain integer string with leading zeros', () => {
    expect(parsePrNumber('007')).toEqual({ value: 7 })
  })

  test('rejects a number larger than Number.MAX_SAFE_INTEGER', () => {
    const result = parsePrNumber(`${Number.MAX_SAFE_INTEGER + 2}`)
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })

  test('rejects a File value from FormData with a controlled error', () => {
    const result = parsePrNumber(new File(['12'], 'pr.txt'))
    expect(result.value).toBeNull()
    expect(result.error).toBe('PR-nummer må være et positivt heltall')
  })
})
