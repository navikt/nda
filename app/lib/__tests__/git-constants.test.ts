import { describe, expect, it } from 'vitest'
import { isFullCommitSha, isValidCommitSha } from '../git-constants'

describe('isFullCommitSha', () => {
  it.each(['a'.repeat(40), 'ABCDEF0123456789abcdef0123456789ABCDEF01'])('accepts full hexadecimal SHA %s', (sha) => {
    expect(isFullCommitSha(sha)).toBe(true)
  })

  it.each([
    '',
    'a'.repeat(7),
    'a'.repeat(39),
    'a'.repeat(41),
    'g'.repeat(40),
    `${'a'.repeat(39)}\n`,
    'refs/heads/main',
  ])('rejects incomplete or non-hexadecimal SHA %j', (sha) => {
    expect(isFullCommitSha(sha)).toBe(false)
  })

  it('leaves short SHA validation unchanged', () => {
    expect(isValidCommitSha('abcdef0')).toBe(true)
    expect(isFullCommitSha('abcdef0')).toBe(false)
    expect(isValidCommitSha('refs/heads/main')).toBe(false)
  })
})
