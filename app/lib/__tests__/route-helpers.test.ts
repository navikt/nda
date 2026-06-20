import { describe, expect, it } from 'vitest'
import { isSafeHttpUrl, parseId } from '../route-helpers'

describe('parseId', () => {
  it('returns null for missing or empty values', () => {
    expect(parseId(null)).toBeNull()
    expect(parseId('')).toBeNull()
    expect(parseId('   ')).toBeNull()
  })

  it('returns null for non-positive or non-integer values', () => {
    expect(parseId('0')).toBeNull()
    expect(parseId('-1')).toBeNull()
    expect(parseId('1.5')).toBeNull()
    expect(parseId('abc')).toBeNull()
    expect(parseId('1e3')).toBe(1000)
    expect(parseId('NaN')).toBeNull()
    expect(parseId('Infinity')).toBeNull()
  })

  it('returns the integer for valid positive integer strings', () => {
    expect(parseId('1')).toBe(1)
    expect(parseId(' 42 ')).toBe(42)
    expect(parseId('1000000')).toBe(1000000)
  })

  it('does not silently accept Number(null) === 0', () => {
    expect(parseId(null)).toBeNull()
  })
})

describe('isSafeHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeHttpUrl('http://example.com')).toBe(true)
    expect(isSafeHttpUrl('https://example.com/path?q=1')).toBe(true)
    expect(isSafeHttpUrl('https://sub.example.com:8443/x')).toBe(true)
  })

  it('rejects dangerous URL schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('JAVASCRIPT:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeHttpUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects empty, malformed, and relative inputs', () => {
    expect(isSafeHttpUrl('')).toBe(false)
    expect(isSafeHttpUrl(null)).toBe(false)
    expect(isSafeHttpUrl(undefined)).toBe(false)
    expect(isSafeHttpUrl('not a url')).toBe(false)
    expect(isSafeHttpUrl('/relative/path')).toBe(false)
    expect(isSafeHttpUrl('//example.com')).toBe(false)
  })
})
