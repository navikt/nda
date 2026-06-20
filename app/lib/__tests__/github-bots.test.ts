import { describe, expect, it } from 'vitest'
import { GITHUB_BOTS, getBotDescription, getBotDisplayName, isGitHubBot } from '../github-bots'

describe('isGitHubBot', () => {
  it.each(Object.keys(GITHUB_BOTS))('recognizes known bot: %s', (bot) => {
    expect(isGitHubBot(bot)).toBe(true)
  })

  it('recognizes unknown [bot] suffix users', () => {
    expect(isGitHubBot('my-custom-app[bot]')).toBe(true)
  })

  it('returns false for regular users', () => {
    expect(isGitHubBot('octocat')).toBe(false)
    expect(isGitHubBot('dependabot')).toBe(false)
  })

  it('returns false for null/undefined/empty', () => {
    expect(isGitHubBot(null)).toBe(false)
    expect(isGitHubBot(undefined)).toBe(false)
    expect(isGitHubBot('')).toBe(false)
  })
})

describe('getBotDisplayName', () => {
  it('returns display name for known bots', () => {
    expect(getBotDisplayName('dependabot[bot]')).toBe('Dependabot')
    expect(getBotDisplayName('renovate[bot]')).toBe('Renovate')
    expect(getBotDisplayName('snyk-bot')).toBe('Snyk')
  })

  it('generates display name for unknown [bot] users', () => {
    expect(getBotDisplayName('my-custom-app[bot]')).toBe('My Custom App (bot)')
  })

  it('handles underscores in bot names', () => {
    expect(getBotDisplayName('some_thing[bot]')).toBe('Some Thing (bot)')
  })

  it('returns null for regular users', () => {
    expect(getBotDisplayName('octocat')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(getBotDisplayName(null)).toBeNull()
    expect(getBotDisplayName(undefined)).toBeNull()
  })
})

describe('getBotDescription', () => {
  it('returns description for known bots', () => {
    expect(getBotDescription('dependabot[bot]')).toContain('avhengighetsoppdatering')
  })

  it('returns generic description for unknown [bot] users', () => {
    expect(getBotDescription('custom-thing[bot]')).toBe('GitHub bot-konto.')
  })

  it('returns null for regular users', () => {
    expect(getBotDescription('octocat')).toBeNull()
  })

  it('returns null for null/undefined', () => {
    expect(getBotDescription(null)).toBeNull()
    expect(getBotDescription(undefined)).toBeNull()
  })
})
