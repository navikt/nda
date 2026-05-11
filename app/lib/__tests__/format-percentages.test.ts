import { describe, expect, it } from 'vitest'
import { formatPercent, formatPercentages } from '../format-percentages'

describe('formatPercent', () => {
  it('omits decimal for whole numbers', () => {
    expect(formatPercent(100)).toBe('100')
    expect(formatPercent(0)).toBe('0')
    expect(formatPercent(50)).toBe('50')
  })

  it('shows 1 decimal for non-whole numbers', () => {
    expect(formatPercent(99.6)).toBe('99.6')
    expect(formatPercent(0.4)).toBe('0.4')
    expect(formatPercent(33.3)).toBe('33.3')
  })

  it('rounds to 1 decimal', () => {
    expect(formatPercent(33.33)).toBe('33.3')
    expect(formatPercent(66.67)).toBe('66.7')
  })
})

describe('formatPercentages', () => {
  it('returns all zeros when total is 0', () => {
    expect(formatPercentages([0, 0, 0], 0)).toEqual(['0', '0', '0'])
    expect(formatPercentages([0, 0], 0)).toEqual(['0', '0'])
  })

  it('returns empty array for empty counts', () => {
    expect(formatPercentages([], 0)).toEqual([])
    expect(formatPercentages([], 100)).toEqual([])
  })

  it('handles 100% in one category', () => {
    expect(formatPercentages([100, 0, 0], 100)).toEqual(['100', '0', '0'])
  })

  it('sums to 100% for the screenshot case (703/706 + 3/706)', () => {
    const result = formatPercentages([703, 3, 0], 706)
    expect(result).toEqual(['99.6', '0.4', '0'])
    const sum = result.reduce((a, b) => a + parseFloat(b), 0)
    expect(sum).toBeCloseTo(100, 1)
  })

  it('sums to 100% for equal thirds', () => {
    const result = formatPercentages([1, 1, 1], 3)
    const sum = result.reduce((a, b) => a + parseFloat(b), 0)
    expect(sum).toBeCloseTo(100, 1)
    expect(result).toEqual(['33.4', '33.3', '33.3'])
  })

  it('sums to 100% for two categories', () => {
    const result = formatPercentages([2, 1], 3)
    const sum = result.reduce((a, b) => a + parseFloat(b), 0)
    expect(sum).toBeCloseTo(100, 1)
  })

  it('handles single category', () => {
    expect(formatPercentages([42], 42)).toEqual(['100'])
  })

  it('gives remainder to largest fractional part', () => {
    // 7/9 = 77.777...%, 2/9 = 22.222...%
    const result = formatPercentages([7, 2], 9)
    const sum = result.reduce((a, b) => a + parseFloat(b), 0)
    expect(sum).toBeCloseTo(100, 1)
    expect(result).toEqual(['77.8', '22.2'])
  })

  it('handles near-50/50 split', () => {
    const result = formatPercentages([501, 499], 1000)
    expect(result).toEqual(['50.1', '49.9'])
  })
})
