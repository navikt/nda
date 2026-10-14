import { describe, expect, it } from 'vitest'
import {
  parseRepositoryDeliveryComparisonRange,
  parseRepositoryDeliveryReviews,
  repositoryDeliveryRangeMatches,
} from '~/lib/repository-code-delivery/evidence'

describe('repository delivery review evidence', () => {
  it('parses a stored comparison range and rejects incomplete values', () => {
    expect(parseRepositoryDeliveryComparisonRange({ baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) })).toEqual({
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
    })
    expect(parseRepositoryDeliveryComparisonRange({ baseSha: 'base' })).toBeNull()
    expect(parseRepositoryDeliveryComparisonRange({ baseSha: 'base', headSha: 'head' })).toBeNull()
    expect(parseRepositoryDeliveryComparisonRange(null)).toBeNull()
  })

  it('compares stored ranges with case-insensitive delivery SHAs', () => {
    const baseSha = 'a'.repeat(40)
    const headSha = 'b'.repeat(40)
    expect(
      repositoryDeliveryRangeMatches(
        { baseSha: baseSha.toUpperCase(), headSha: headSha.toUpperCase() },
        { baseSha, headSha },
      ),
    ).toBe(true)
    expect(repositoryDeliveryRangeMatches({ baseSha, headSha: 'c'.repeat(40) }, { baseSha, headSha })).toBe(false)
    expect(repositoryDeliveryRangeMatches(null, { baseSha, headSha })).toBeNull()
    expect(repositoryDeliveryRangeMatches({ baseSha: 'base', headSha }, { baseSha, headSha })).toBeNull()
  })

  it('parses reviews from the supported stored shapes and excludes review bodies', () => {
    expect(
      parseRepositoryDeliveryReviews({
        reviews: [
          {
            id: 1,
            username: 'reviewer',
            state: 'APPROVED',
            submittedAt: '2026-01-01T12:00:00Z',
            commitId: 'abc',
            body: 'Private review text',
          },
        ],
      }),
    ).toEqual([
      {
        id: 1,
        username: 'reviewer',
        state: 'APPROVED',
        submittedAt: '2026-01-01T12:00:00Z',
        commitSha: 'abc',
      },
    ])
    expect(parseRepositoryDeliveryReviews([])).toEqual([])
    expect(parseRepositoryDeliveryReviews({ reviews: [] })).toEqual([])
    expect(parseRepositoryDeliveryReviews([{ username: 'missing-state' }])).toBeNull()
    expect(parseRepositoryDeliveryReviews(null)).toBeNull()
  })
})
