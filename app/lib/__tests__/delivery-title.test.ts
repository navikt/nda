import { describe, expect, it } from 'vitest'
import { computeDisplayTitle, isExclusivelyThisPr } from '../delivery-title'

describe('isExclusivelyThisPr', () => {
  it('returns false when there is no PR number', () => {
    expect(isExclusivelyThisPr(false, ['a', 'b'], new Set(['a', 'b']))).toBe(false)
  })

  it('returns false when PR commit shas are unknown', () => {
    expect(isExclusivelyThisPr(true, ['a'], null)).toBe(false)
  })

  it('returns true when every delivery commit belongs to the PR', () => {
    expect(isExclusivelyThisPr(true, ['a', 'b'], new Set(['a', 'b', 'c']))).toBe(true)
  })

  it('returns false when a delivery commit is outside the PR (e.g. bundled dependabot push)', () => {
    expect(isExclusivelyThisPr(true, ['a', 'dependabot-sha'], new Set(['a']))).toBe(false)
  })

  it('returns true for an empty delivery commit list', () => {
    expect(isExclusivelyThisPr(true, [], new Set(['a']))).toBe(true)
  })
})

describe('computeDisplayTitle', () => {
  it('returns the base title unchanged when the delivery is exclusively the PR', () => {
    expect(computeDisplayTitle('Min PR-tittel', 3, true)).toBe('Min PR-tittel')
  })

  it('returns the base title unchanged when there is only one commit', () => {
    expect(computeDisplayTitle('Bump lib to 1.2.3', 1, false)).toBe('Bump lib to 1.2.3')
  })

  it('appends a singular suffix for exactly one extra commit', () => {
    expect(computeDisplayTitle('Bump lib to 1.2.3', 2, false)).toBe('Bump lib to 1.2.3 + 1 commit til')
  })

  it('appends a plural suffix for multiple extra commits', () => {
    expect(computeDisplayTitle('Bump lib to 1.2.3', 3, false)).toBe('Bump lib to 1.2.3 + 2 committer til')
  })

  it('passes through a null base title', () => {
    expect(computeDisplayTitle(null, 1, false)).toBe(null)
  })

  it('passes through a null base title even with multiple commits, avoiding a "null + N" string', () => {
    expect(computeDisplayTitle(null, 3, false)).toBe(null)
  })

  it('passes through an empty base title even with multiple commits', () => {
    expect(computeDisplayTitle('', 3, false)).toBe('')
  })
})
