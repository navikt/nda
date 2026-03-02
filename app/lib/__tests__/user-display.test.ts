import { describe, expect, it } from 'vitest'
import { getUserDisplayName, serializeUserMappings, type UserMappings } from '../user-display'

/**
 * Tests for user display name resolution.
 *
 * WHY: getUserDisplayName() is called everywhere a username is shown in the UI.
 * It has a specific priority chain: bot name > display_name > nav_email > raw username.
 * If the fallback order is broken, users see wrong names across the entire application.
 * These tests pin down each step in the fallback chain.
 */

describe('getUserDisplayName — resolves GitHub username to display name with fallback chain', () => {
  const mappings: UserMappings = {
    'ola.nordmann': { display_name: 'Ola Nordmann', nav_ident: 'O123456', nav_email: 'ola@nav.no' },
    'kari.hansen': { display_name: null, nav_email: 'kari@nav.no' },
    'per.person': { display_name: null, nav_email: null },
  }

  it('returns null for null/undefined input (no username available)', () => {
    expect(getUserDisplayName(null, mappings)).toBeNull()
    expect(getUserDisplayName(undefined, mappings)).toBeNull()
  })

  it('returns bot display name for known GitHub bots', () => {
    // dependabot[bot] is a known bot in github-bots.ts
    const result = getUserDisplayName('dependabot[bot]', mappings)
    expect(result).toBe('Dependabot')
  })

  it('prefers display_name when mapping exists', () => {
    expect(getUserDisplayName('ola.nordmann', mappings)).toBe('Ola Nordmann')
  })

  it('falls back to nav_email when display_name is null', () => {
    expect(getUserDisplayName('kari.hansen', mappings)).toBe('kari@nav.no')
  })

  it('falls back to raw username when both display_name and nav_email are null', () => {
    expect(getUserDisplayName('per.person', mappings)).toBe('per.person')
  })

  it('falls back to raw username when no mapping exists at all', () => {
    expect(getUserDisplayName('unknown-user', mappings)).toBe('unknown-user')
  })

  it('returns empty string username as-is (edge case)', () => {
    expect(getUserDisplayName('', mappings)).toBeNull()
  })
})

describe('serializeUserMappings — converts Map to plain object for JSON transport', () => {
  it('converts empty Map to empty object', () => {
    const result = serializeUserMappings(new Map())
    expect(result).toEqual({})
  })

  it('preserves all fields from Map entries', () => {
    const map = new Map([
      ['alice', { display_name: 'Alice A', nav_ident: 'A1', nav_email: 'alice@nav.no' }],
      ['bob', { display_name: null, nav_ident: null, nav_email: undefined }],
    ])

    const result = serializeUserMappings(map)
    expect(result).toEqual({
      alice: { display_name: 'Alice A', nav_ident: 'A1', nav_email: 'alice@nav.no' },
      bob: { display_name: null, nav_ident: null, nav_email: undefined },
    })
  })
})
