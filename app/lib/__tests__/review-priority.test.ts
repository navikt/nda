import { describe, expect, it } from 'vitest'

interface Review {
  username: string
  avatar_url: string
  state: string
  submitted_at: string
}

function processReviews(
  reviews: Array<{ user: { login: string; avatar_url: string }; state: string; submitted_at: string }>,
): Map<string, Review> {
  const reviewsByUser = new Map<string, Review>()

  for (const review of reviews) {
    const existing = reviewsByUser.get(review.user.login)

    let shouldUpdate = false
    if (!existing) {
      shouldUpdate = true
    } else if (review.state === 'APPROVED' && existing.state !== 'APPROVED') {
      shouldUpdate = true
    } else if (review.state === 'APPROVED' && existing.state === 'APPROVED') {
      shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
    } else if (review.state !== 'APPROVED' && existing.state !== 'APPROVED') {
      shouldUpdate = new Date(review.submitted_at) > new Date(existing.submitted_at)
    }

    if (shouldUpdate) {
      reviewsByUser.set(review.user.login, {
        username: review.user.login,
        avatar_url: review.user.avatar_url,
        state: review.state,
        submitted_at: review.submitted_at,
      })
    }
  }

  return reviewsByUser
}

describe('Review Priority Logic', () => {
  describe('APPROVED should not be overwritten by COMMENTED', () => {
    it('keeps APPROVED when COMMENTED comes after', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:55:17Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-14T06:50:38Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('APPROVED')
      expect(review?.submitted_at).toBe('2025-11-13T13:55:17Z')
    })

    it('keeps APPROVED when multiple COMMENTED come after', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:55:17Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-14T06:47:24Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-14T06:50:38Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('APPROVED')
    })

    it('uses latest APPROVED when multiple APPROVED exist', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T12:29:05Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'DISMISSED', submitted_at: '2025-11-13T12:31:15Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:55:17Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-14T06:50:38Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('APPROVED')
      expect(review?.submitted_at).toBe('2025-11-13T13:55:17Z')
    })
  })

  describe('APPROVED should overwrite other states', () => {
    it('APPROVED overwrites earlier COMMENTED', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-13T10:00:00Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:55:17Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('APPROVED')
    })

    it('APPROVED overwrites earlier CHANGES_REQUESTED', () => {
      const reviews = [
        {
          user: { login: 'reviewer1', avatar_url: '' },
          state: 'CHANGES_REQUESTED',
          submitted_at: '2025-11-13T10:00:00Z',
        },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:55:17Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('APPROVED')
    })

    it('APPROVED overwrites earlier DISMISSED', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'DISMISSED', submitted_at: '2025-11-13T10:00:00Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:55:17Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('APPROVED')
    })
  })

  describe('Non-APPROVED states use latest timestamp', () => {
    it('keeps latest COMMENTED when no APPROVED exists', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-13T10:00:00Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-13T14:00:00Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('COMMENTED')
      expect(review?.submitted_at).toBe('2025-11-13T14:00:00Z')
    })

    it('keeps latest between CHANGES_REQUESTED and COMMENTED', () => {
      const reviews = [
        {
          user: { login: 'reviewer1', avatar_url: '' },
          state: 'CHANGES_REQUESTED',
          submitted_at: '2025-11-13T10:00:00Z',
        },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-13T14:00:00Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('COMMENTED')
      expect(review?.submitted_at).toBe('2025-11-13T14:00:00Z')
    })
  })

  describe('Multiple reviewers', () => {
    it('handles multiple reviewers independently', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:00:00Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-13T14:00:00Z' },
        {
          user: { login: 'reviewer2', avatar_url: '' },
          state: 'CHANGES_REQUESTED',
          submitted_at: '2025-11-13T12:00:00Z',
        },
        { user: { login: 'reviewer2', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T15:00:00Z' },
      ]

      const result = processReviews(reviews)

      expect(result.get('reviewer1')?.state).toBe('APPROVED')
      expect(result.get('reviewer2')?.state).toBe('APPROVED')
    })

    it('one reviewer approved, another only commented', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:00:00Z' },
        { user: { login: 'reviewer2', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-13T14:00:00Z' },
      ]

      const result = processReviews(reviews)

      expect(result.get('reviewer1')?.state).toBe('APPROVED')
      expect(result.get('reviewer2')?.state).toBe('COMMENTED')
    })
  })

  describe('Real-world scenario: approval with later comments', () => {
    it('correctly identifies approval despite later comments', () => {
      const reviews = [
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T12:29:05Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'DISMISSED', submitted_at: '2025-11-13T12:31:15Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'DISMISSED', submitted_at: '2025-11-13T12:35:26Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2025-11-13T13:55:17Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-14T06:47:24Z' },
        { user: { login: 'reviewer1', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2025-11-14T06:50:38Z' },
      ]

      const result = processReviews(reviews)
      const review = result.get('reviewer1')

      expect(review?.state).toBe('APPROVED')
      expect(review?.submitted_at).toBe('2025-11-13T13:55:17Z')
    })
  })
})
