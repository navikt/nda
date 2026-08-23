import { describe, expect, it } from 'vitest'
import {
  mapPrComments,
  mapPrCommits,
  mapPrMetadata,
  mapPrReviewBodyComments,
  mapPrReviews,
  type RawIssueComment,
  type RawPr,
  type RawPrCommit,
  type RawPrReview,
  type RawReviewComment,
} from '../github/pr-snapshot'

function makeRawPr(overrides: Record<string, unknown> = {}): RawPr {
  return {
    title: 'Fix calculation',
    body: 'Fixes the bug',
    labels: ['bug', { name: 'priority-high' }],
    created_at: '2026-02-20T10:00:00Z',
    merged_at: '2026-02-25T14:30:00Z',
    base: { ref: 'main', sha: 'abc123' },
    head: { ref: 'feature/x', sha: 'def456' },
    merge_commit_sha: 'merge789',
    commits: 3,
    changed_files: 5,
    additions: 120,
    deletions: 40,
    comments: 2,
    review_comments: 1,
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    rebaseable: true,
    locked: false,
    maintainer_can_modify: true,
    auto_merge: null,
    user: { login: 'developer-a', avatar_url: 'https://avatar/a' },
    merged_by: null,
    assignees: [],
    requested_reviewers: [],
    requested_teams: [],
    milestone: null,
    ...overrides,
  } as unknown as RawPr
}

describe('mapPrMetadata', () => {
  it('maps basic PR fields and normalizes labels', () => {
    const result = mapPrMetadata(makeRawPr())

    expect(result.title).toBe('Fix calculation')
    expect(result.labels).toEqual(['bug', 'priority-high'])
    expect(result.base_branch).toBe('main')
    expect(result.head_sha).toBe('def456')
    expect(result.creator).toEqual({ username: 'developer-a', avatar_url: 'https://avatar/a' })
  })

  it('maps auto_merge, merged_by, merger and milestone when present', () => {
    const result = mapPrMetadata(
      makeRawPr({
        auto_merge: { enabled_by: { login: 'developer-b' }, merge_method: 'squash' },
        merged_by: { login: 'developer-b', avatar_url: 'https://avatar/b' },
        milestone: { title: 'Sprint 42', number: 42, state: 'open' },
      }),
    )

    expect(result.auto_merge).toEqual({ enabled_by: 'developer-b', merge_method: 'squash' })
    expect(result.merged_by).toEqual({ username: 'developer-b', avatar_url: 'https://avatar/b' })
    expect(result.merger).toEqual({ username: 'developer-b', avatar_url: 'https://avatar/b' })
    expect(result.milestone).toEqual({ title: 'Sprint 42', number: 42, state: 'open' })
  })

  it('falls back to defaults when optional fields are missing', () => {
    const result = mapPrMetadata(makeRawPr({ user: null, draft: undefined, rebaseable: undefined }))

    expect(result.creator).toEqual({ username: 'unknown', avatar_url: '' })
    expect(result.draft).toBe(false)
    expect(result.rebaseable).toBeNull()
  })
})

function makeReview(overrides: Record<string, unknown> = {}): RawPrReview {
  return {
    id: 1,
    user: { login: 'developer-b', avatar_url: 'https://avatar/b' },
    state: 'COMMENTED',
    submitted_at: '2026-02-23T08:00:00Z',
    commit_id: 'sha1',
    body: null,
    html_url: 'https://github.com/pr/1#review-1',
    ...overrides,
  } as unknown as RawPrReview
}

describe('mapPrReviews', () => {
  it('keeps only the latest review per user', () => {
    const reviews = [
      makeReview({ id: 1, state: 'COMMENTED', submitted_at: '2026-02-23T08:00:00Z' }),
      makeReview({ id: 2, state: 'CHANGES_REQUESTED', submitted_at: '2026-02-24T08:00:00Z' }),
    ]

    const result = mapPrReviews(reviews)

    expect(result).toHaveLength(1)
    expect(result[0].state).toBe('CHANGES_REQUESTED')
  })

  it('prioritizes an APPROVED review over a later non-approved review', () => {
    const reviews = [
      makeReview({ id: 1, state: 'APPROVED', submitted_at: '2026-02-23T08:00:00Z' }),
      makeReview({ id: 2, state: 'COMMENTED', submitted_at: '2026-02-24T08:00:00Z' }),
    ]

    const result = mapPrReviews(reviews)

    expect(result).toHaveLength(1)
    expect(result[0].state).toBe('APPROVED')
  })

  it('replaces an earlier APPROVED review with a later APPROVED review', () => {
    const reviews = [
      makeReview({ id: 1, state: 'APPROVED', submitted_at: '2026-02-23T08:00:00Z', commit_id: 'sha1' }),
      makeReview({ id: 2, state: 'APPROVED', submitted_at: '2026-02-24T08:00:00Z', commit_id: 'sha2' }),
    ]

    const result = mapPrReviews(reviews)

    expect(result).toHaveLength(1)
    expect(result[0].commit_id).toBe('sha2')
  })

  it('ignores reviews without a user or submitted_at', () => {
    const reviews = [
      makeReview({ user: null }),
      makeReview({ submitted_at: null }),
      makeReview({ id: 3, user: { login: 'developer-c', avatar_url: '' } }),
    ]

    const result = mapPrReviews(reviews)

    expect(result).toHaveLength(1)
    expect(result[0].username).toBe('developer-c')
  })
})

describe('mapPrReviewBodyComments', () => {
  it('only includes reviews with a non-empty body', () => {
    const reviews = [
      makeReview({ id: 1, body: 'LGTM' }),
      makeReview({ id: 2, body: '   ' }),
      makeReview({ id: 3, body: null }),
    ]

    const result = mapPrReviewBodyComments(reviews)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 1,
      body: 'LGTM',
      user: { username: 'developer-b', avatar_url: 'https://avatar/b' },
      created_at: '2026-02-23T08:00:00Z',
      html_url: 'https://github.com/pr/1#review-1',
    })
  })
})

function makeCommit(overrides: Record<string, unknown> = {}): RawPrCommit {
  return {
    sha: 'aaa111',
    html_url: 'https://github.com/commit/aaa111',
    author: { login: 'developer-a', avatar_url: 'https://avatar/a' },
    parents: [{ sha: 'parent1' }],
    commit: {
      message: 'Initial implementation',
      author: { name: 'Developer A', date: '2026-02-20T11:00:00Z' },
      committer: { date: '2026-02-20T11:05:00Z' },
    },
    ...overrides,
  } as unknown as RawPrCommit
}

describe('mapPrCommits', () => {
  it('maps commit fields including parent shas', () => {
    const result = mapPrCommits([makeCommit()])

    expect(result).toEqual([
      {
        sha: 'aaa111',
        message: 'Initial implementation',
        author: { username: 'developer-a', login: 'developer-a', avatar_url: 'https://avatar/a' },
        date: '2026-02-20T11:00:00Z',
        committer_date: '2026-02-20T11:05:00Z',
        parent_shas: ['parent1'],
        html_url: 'https://github.com/commit/aaa111',
      },
    ])
  })

  it('falls back to commit author name when GitHub user is missing', () => {
    const result = mapPrCommits([makeCommit({ author: null })])

    expect(result[0].author).toEqual({ username: 'Developer A', login: null, avatar_url: '' })
  })
})

describe('mapPrComments', () => {
  const issueComment = {
    id: 10,
    body: 'Please fix this',
    user: { login: 'developer-c', avatar_url: 'https://avatar/c' },
    created_at: '2026-02-21T09:00:00Z',
    html_url: 'https://github.com/issue-comment/10',
  } as unknown as RawIssueComment

  const reviewComment = {
    id: 20,
    body: 'Inline nit',
    user: { login: 'developer-b', avatar_url: 'https://avatar/b' },
    created_at: '2026-02-22T09:00:00Z',
    html_url: 'https://github.com/review-comment/20',
  } as unknown as RawReviewComment

  it('merges issue comments and review comments', () => {
    const result = mapPrComments([issueComment], [reviewComment])

    expect(result).toEqual([
      {
        id: 10,
        body: 'Please fix this',
        user: { username: 'developer-c', avatar_url: 'https://avatar/c' },
        created_at: '2026-02-21T09:00:00Z',
        html_url: 'https://github.com/issue-comment/10',
      },
      {
        id: 20,
        body: 'Inline nit',
        user: { username: 'developer-b', avatar_url: 'https://avatar/b' },
        created_at: '2026-02-22T09:00:00Z',
        html_url: 'https://github.com/review-comment/20',
      },
    ])
  })

  it('falls back to defaults when user or body is missing', () => {
    const result = mapPrComments([{ ...issueComment, user: null, body: null } as unknown as RawIssueComment], [])

    expect(result).toEqual([
      {
        id: 10,
        body: '',
        user: { username: 'unknown', avatar_url: '' },
        created_at: '2026-02-21T09:00:00Z',
        html_url: 'https://github.com/issue-comment/10',
      },
    ])
  })
})
