import { describe, expect, it } from 'vitest'
import { isRepositoryApprovalId, parseRepositoryApprovalId, parseReviewTime } from '../repository-manual-approval'

describe('repository approval input validation', () => {
  it.each(['0', '-1', '1x', '1.1', 'NaN', 'Infinity', '2147483648', '', null])('rejects invalid ID %j', (value) => {
    expect(parseRepositoryApprovalId(value)).toBeNull()
  })
  it.each([NaN, Infinity, -1, 0, 1.1, 2_147_483_648])('rejects numeric ID %s', (value) => {
    expect(isRepositoryApprovalId(value)).toBe(false)
  })
  it('accepts valid IDs', () => {
    expect(parseRepositoryApprovalId('17')).toBe(17)
    expect(isRepositoryApprovalId(2_147_483_647)).toBe(true)
  })
  it.each([
    '',
    'invalid',
    '2026-10-18T10:00',
    '2026-10-18T10:00:00',
    '2026-02-30T10:00:00Z',
    '2026-13-01T10:00:00Z',
    '2026-10-18T24:00:00Z',
  ])('rejects missing, invalid or timezone-free time %s', (value) => {
    expect(parseReviewTime(value)).toBeNull()
  })
  it('preserves explicit timezones and milliseconds', () => {
    expect(parseReviewTime('2026-10-18T12:00:00+02:00')).toEqual(new Date('2026-10-18T10:00:00Z'))
    expect(parseReviewTime('2026-10-18T10:00:00.123Z')).toEqual(new Date('2026-10-18T10:00:00.123Z'))
  })
})
