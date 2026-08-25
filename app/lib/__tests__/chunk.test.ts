import { describe, expect, it } from 'vitest'
import { chunk } from '../chunk'

describe('chunk', () => {
  it('splits an array into chunks of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns a single chunk when size is larger than the array', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]])
  })

  it('returns an empty array for an empty input', () => {
    expect(chunk([], 5)).toEqual([])
  })

  it('throws for a size of 0', () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow('chunk size must be greater than 0, got 0')
  })

  it('throws for a negative size', () => {
    expect(() => chunk([1, 2, 3], -1)).toThrow('chunk size must be greater than 0, got -1')
  })
})
