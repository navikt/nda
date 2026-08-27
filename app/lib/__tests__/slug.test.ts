import { describe, expect, it } from 'vitest'
import { generateUniqueSlug, slugify } from '../slug.server'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Pensjon og uføre')).toBe('pensjon-og-ufore')
  })

  it('handles Norwegian characters', () => {
    expect(slugify('Æblegrød på Åsane')).toBe('aeblegrod-pa-asane')
  })

  it('strips special characters', () => {
    expect(slugify('Team Pensjon (Ytelse)!')).toBe('team-pensjon-ytelse')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --Pensjon--  ')).toBe('pensjon')
  })
})

describe('generateUniqueSlug', () => {
  it('returns the slugified name when it does not exist', async () => {
    const slug = await generateUniqueSlug('Pensjon', async () => false)
    expect(slug).toBe('pensjon')
  })

  it('appends a numeric suffix when the slug already exists', async () => {
    const existing = new Set(['pensjon', 'pensjon-2'])
    const slug = await generateUniqueSlug('Pensjon', async (candidate) => existing.has(candidate))
    expect(slug).toBe('pensjon-3')
  })

  it('falls back to a default base when the name has no usable characters', async () => {
    const slug = await generateUniqueSlug('!!!', async () => false)
    expect(slug).toBe('ny')
  })
})
