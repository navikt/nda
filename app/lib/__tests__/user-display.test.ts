import { describe, expect, it } from 'vitest'
import { formatDisplayNameNatural, getUserDisplayName, serializeUserLookups, type UserLookupMap } from '../user-display'

describe('getUserDisplayName — resolves GitHub username to display name with fallback chain', () => {
  const mappings: UserLookupMap = {
    'modig.bjork': { display_name: 'Modig Bjørk', nav_ident: 'Z990007' },
    'kari.hansen': { display_name: null },
    'per.person': { display_name: null },
  }

  it('returns null for null/undefined input (no username available)', () => {
    expect(getUserDisplayName(null, mappings)).toBeNull()
    expect(getUserDisplayName(undefined, mappings)).toBeNull()
  })

  it('returns bot display name for known GitHub bots', () => {
    const result = getUserDisplayName('dependabot[bot]', mappings)
    expect(result).toBe('Dependabot')
  })

  it('prefers display_name when mapping exists', () => {
    expect(getUserDisplayName('modig.bjork', mappings)).toBe('Modig Bjørk')
  })

  it('falls back to raw username when display_name is null', () => {
    expect(getUserDisplayName('per.person', mappings)).toBe('per.person')
  })

  it('falls back to raw username when no mapping exists at all', () => {
    expect(getUserDisplayName('unknown-user', mappings)).toBe('unknown-user')
  })

  it('returns empty string username as-is (edge case)', () => {
    expect(getUserDisplayName('', mappings)).toBeNull()
  })
})

describe('serializeUserLookups — converts Map to plain object for JSON transport', () => {
  it('converts empty Map to empty object', () => {
    const result = serializeUserLookups(new Map())
    expect(result).toEqual({})
  })

  it('preserves all fields from Map entries', () => {
    const map = new Map([
      ['alice', { display_name: 'Alice A', nav_ident: 'Z990001' }],
      ['bob', { display_name: null, nav_ident: null }],
    ])

    const result = serializeUserLookups(map)
    expect(result).toEqual({
      alice: { display_name: 'Alice A', nav_ident: 'Z990001' },
      bob: { display_name: null, nav_ident: null },
    })
  })
})

describe('formatDisplayNameNatural — converts "Lastname, Firstname" to "Firstname Lastname"', () => {
  it('converts comma-separated "Lastname, Firstname" format', () => {
    expect(formatDisplayNameNatural('Røe, Modig')).toBe('Modig Røe')
  })

  it('returns name as-is when no comma is present', () => {
    expect(formatDisplayNameNatural('Glad Fjord')).toBe('Glad Fjord')
  })

  it('returns empty string for null input', () => {
    expect(formatDisplayNameNatural(null)).toBe('')
  })

  it('returns empty string for empty string input', () => {
    expect(formatDisplayNameNatural('')).toBe('')
  })

  it('handles multiple commas (keeps first part as lastname)', () => {
    expect(formatDisplayNameNatural('Skog, Stille, Jr')).toBe('Stille, Jr Skog')
  })
})
