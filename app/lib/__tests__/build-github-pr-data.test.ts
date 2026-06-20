/**
 * Tests for building GitHubPRData from V2 snapshots.
 *
 * Verifies that buildGithubPrDataFromSnapshots correctly maps all fields
 * from V2 camelCase snapshot types to V1 snake_case GitHubPRData format.
 */
import { describe, expect, it } from 'vitest'
import { buildGithubPrDataFromSnapshots } from '../verification/build-github-pr-data'
import type { PrChecks, PrComment, PrCommit, PrMetadata, PrReview } from '../verification/types'

// =============================================================================
// Test Fixtures
// =============================================================================

const metadata: PrMetadata = {
  number: 18220,
  title: 'PEN-1234: Fix calculation',
  body: 'This PR fixes the calculation logic.',
  state: 'closed',
  merged: true,
  draft: false,
  createdAt: '2026-02-20T10:00:00Z',
  updatedAt: '2026-02-20T10:00:00Z',
  mergedAt: '2026-02-25T14:30:00Z',
  closedAt: '2026-02-25T14:30:00Z',
  baseBranch: 'main',
  baseSha: 'abc123',
  headBranch: 'feature/PEN-1234',
  headSha: 'def456',
  mergeCommitSha: 'merge789',
  author: { username: 'developer-a', avatarUrl: 'https://avatar.example.com/a' },
  mergedBy: { username: 'developer-b', avatarUrl: 'https://avatar.example.com/b' },
  labels: ['bug', 'priority-high'],
  commitsCount: 3,
  changedFiles: 5,
  additions: 120,
  deletions: 40,
  // Extended fields
  commentsCount: 2,
  reviewCommentsCount: 1,
  locked: false,
  mergeable: true,
  mergeableState: 'clean',
  rebaseable: true,
  maintainerCanModify: true,
  autoMerge: null,
  merger: { username: 'developer-b', avatarUrl: 'https://avatar.example.com/b' },
  assignees: [{ username: 'developer-a', avatarUrl: 'https://avatar.example.com/a' }],
  requestedReviewers: [{ username: 'developer-c', avatarUrl: 'https://avatar.example.com/c' }],
  requestedTeams: [{ name: 'Team Pensjon', slug: 'team-pensjon' }],
  milestone: { title: 'Sprint 42', number: 42, state: 'open' },
  checksPassed: true,
}

const reviews: PrReview[] = [
  { id: 1, username: 'developer-b', state: 'APPROVED', submittedAt: '2026-02-24T10:00:00Z', body: 'LGTM' },
  { id: 2, username: 'developer-c', state: 'COMMENTED', submittedAt: '2026-02-23T08:00:00Z', body: null },
]

const commits: PrCommit[] = [
  {
    sha: 'aaa111',
    message: 'Initial implementation',
    authorUsername: 'developer-a',
    authorDate: '2026-02-20T11:00:00Z',
    committerDate: '2026-02-20T11:00:00Z',
    isMergeCommit: false,
    parentShas: ['parent1'],
  },
  {
    sha: 'bbb222',
    message: 'Fix review comments',
    authorUsername: 'developer-a',
    authorDate: '2026-02-22T09:00:00Z',
    committerDate: '2026-02-22T09:00:00Z',
    isMergeCommit: false,
    parentShas: ['aaa111'],
  },
]

const checks: PrChecks = {
  conclusion: 'success',
  checkRuns: [
    {
      id: 101,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      startedAt: '2026-02-22T09:05:00Z',
      completedAt: '2026-02-22T09:10:00Z',
      htmlUrl: 'https://github.com/navikt/pensjon-pen/runs/101',
      headSha: 'bbb222',
      detailsUrl: null,
      externalId: null,
      checkSuiteId: 500,
      app: { name: 'GitHub Actions', slug: 'github-actions' },
      output: { title: 'Build succeeded', summary: 'All tests passed', text: null, annotationsCount: 0 },
    },
  ],
  statuses: [],
}

const comments: PrComment[] = [
  {
    id: 201,
    username: 'developer-b',
    body: 'Can you fix the edge case?',
    createdAt: '2026-02-21T15:00:00Z',
    updatedAt: '2026-02-21T15:00:00Z',
  },
]

// =============================================================================
// Tests
// =============================================================================

describe('buildGithubPrDataFromSnapshots', () => {
  it('maps all basic metadata fields', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.title).toBe('PEN-1234: Fix calculation')
    expect(result.body).toBe('This PR fixes the calculation logic.')
    expect(result.labels).toEqual(['bug', 'priority-high'])
    expect(result.created_at).toBe('2026-02-20T10:00:00Z')
    expect(result.merged_at).toBe('2026-02-25T14:30:00Z')
    expect(result.draft).toBe(false)
  })

  it('maps branch and SHA fields', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.base_branch).toBe('main')
    expect(result.base_sha).toBe('abc123')
    expect(result.head_branch).toBe('feature/PEN-1234')
    expect(result.head_sha).toBe('def456')
    expect(result.merge_commit_sha).toBe('merge789')
  })

  it('maps statistics fields', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.commits_count).toBe(3)
    expect(result.changed_files).toBe(5)
    expect(result.additions).toBe(120)
    expect(result.deletions).toBe(40)
    expect(result.comments_count).toBe(2)
    expect(result.review_comments_count).toBe(1)
  })

  it('maps people fields (creator, merged_by, merger)', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.creator).toEqual({ username: 'developer-a', avatar_url: 'https://avatar.example.com/a' })
    expect(result.merged_by).toEqual({ username: 'developer-b', avatar_url: 'https://avatar.example.com/b' })
    expect(result.merger).toEqual({ username: 'developer-b', avatar_url: 'https://avatar.example.com/b' })
  })

  it('maps extended metadata fields', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.locked).toBe(false)
    expect(result.mergeable).toBe(true)
    expect(result.mergeable_state).toBe('clean')
    expect(result.rebaseable).toBe(true)
    expect(result.maintainer_can_modify).toBe(true)
    expect(result.auto_merge).toBeNull()
  })

  it('maps collaboration fields', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.assignees).toEqual([{ username: 'developer-a', avatar_url: 'https://avatar.example.com/a' }])
    expect(result.requested_reviewers).toEqual([
      { username: 'developer-c', avatar_url: 'https://avatar.example.com/c' },
    ])
    expect(result.requested_teams).toEqual([{ name: 'Team Pensjon', slug: 'team-pensjon' }])
    expect(result.milestone).toEqual({ title: 'Sprint 42', number: 42, state: 'open' })
  })

  it('maps reviewers from PrReview[] to GitHubPRData format', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.reviewers).toHaveLength(2)
    expect(result.reviewers[0]).toEqual({
      username: 'developer-b',
      avatar_url: '',
      state: 'APPROVED',
      submitted_at: '2026-02-24T10:00:00Z',
    })
    expect(result.reviewers[1]).toEqual({
      username: 'developer-c',
      avatar_url: '',
      state: 'COMMENTED',
      submitted_at: '2026-02-23T08:00:00Z',
    })
  })

  it('maps commits from PrCommit[] to GitHubPRData format', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.commits).toHaveLength(2)
    expect(result.commits[0]).toEqual({
      sha: 'aaa111',
      message: 'Initial implementation',
      author: { username: 'developer-a', avatar_url: '' },
      date: '2026-02-20T11:00:00Z',
      html_url: '',
    })
  })

  it('maps checks from PrChecks to GitHubPRData format', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.checks_passed).toBe(true)
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].id).toBe(101)
    expect(result.checks[0].name).toBe('build')
    expect(result.checks[0].status).toBe('completed')
    expect(result.checks[0].conclusion).toBe('success')
    expect(result.checks[0].app).toEqual({ name: 'GitHub Actions', slug: 'github-actions' })
    expect(result.checks[0].output).toEqual({
      title: 'Build succeeded',
      summary: 'All tests passed',
      text: null,
      annotations_count: 0,
    })
  })

  it('maps comments from PrComment[] to GitHubPRData format', () => {
    const result = buildGithubPrDataFromSnapshots(metadata, reviews, commits, checks, comments)

    expect(result.comments).toHaveLength(1)
    expect(result.comments[0]).toEqual({
      id: 201,
      body: 'Can you fix the edge case?',
      user: { username: 'developer-b', avatar_url: '' },
      created_at: '2026-02-21T15:00:00Z',
      html_url: '',
    })
  })

  it('handles missing extended fields gracefully (schema v1 data)', () => {
    const v1Metadata: PrMetadata = {
      number: 100,
      title: 'Old PR',
      body: null,
      state: 'closed',
      merged: true,
      draft: false,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      mergedAt: '2025-01-02T00:00:00Z',
      closedAt: '2025-01-02T00:00:00Z',
      baseBranch: 'main',
      baseSha: 'old123',
      headBranch: 'feature/old',
      headSha: 'old456',
      mergeCommitSha: null,
      author: { username: 'dev' },
      mergedBy: null,
      labels: [],
      commitsCount: 1,
      changedFiles: 1,
      additions: 10,
      deletions: 5,
      // No extended fields (schema v1)
    }

    const result = buildGithubPrDataFromSnapshots(v1Metadata, [], [], null, null)

    expect(result.comments_count).toBe(0)
    expect(result.review_comments_count).toBe(0)
    expect(result.locked).toBe(false)
    expect(result.mergeable).toBeNull()
    expect(result.mergeable_state).toBeNull()
    expect(result.rebaseable).toBeNull()
    expect(result.maintainer_can_modify).toBe(false)
    expect(result.auto_merge).toBeNull()
    expect(result.merger).toBeNull()
    expect(result.assignees).toEqual([])
    expect(result.requested_reviewers).toEqual([])
    expect(result.requested_teams).toEqual([])
    expect(result.milestone).toBeNull()
    expect(result.checks_passed).toBeNull()
    expect(result.checks).toEqual([])
    expect(result.comments).toEqual([])
    expect(result.reviewers).toEqual([])
    expect(result.commits).toEqual([])
  })

  it('maps auto_merge correctly', () => {
    const metaWithAutoMerge: PrMetadata = {
      ...metadata,
      autoMerge: { enabledBy: 'developer-a', mergeMethod: 'squash' },
    }

    const result = buildGithubPrDataFromSnapshots(metaWithAutoMerge, reviews, commits, checks, comments)

    expect(result.auto_merge).toEqual({
      enabled_by: 'developer-a',
      merge_method: 'squash',
    })
  })

  describe('checks_ref derivation', () => {
    const makeCheckRun = (headSha?: string) => ({
      id: 1,
      name: 'build',
      status: 'completed' as const,
      conclusion: 'success',
      startedAt: null,
      completedAt: null,
      ...(headSha !== undefined ? { headSha } : {}),
    })

    it('returns merge_commit when first check headSha matches mergeCommitSha', () => {
      const mergeChecks: PrChecks = {
        conclusion: 'success',
        checkRuns: [makeCheckRun('merge789')],
        statuses: [],
      }
      const result = buildGithubPrDataFromSnapshots(metadata, null, null, mergeChecks, null)
      expect(result.checks_ref).toBe('merge_commit')
    })

    it('returns head when first check headSha matches headSha (feature branch)', () => {
      const branchChecks: PrChecks = {
        conclusion: 'success',
        checkRuns: [makeCheckRun('def456')],
        statuses: [],
      }
      const result = buildGithubPrDataFromSnapshots(metadata, null, null, branchChecks, null)
      expect(result.checks_ref).toBe('head')
    })

    it('returns null when headSha matches neither mergeCommitSha nor headSha', () => {
      const unknownChecks: PrChecks = {
        conclusion: 'success',
        checkRuns: [makeCheckRun('unknown999')],
        statuses: [],
      }
      const result = buildGithubPrDataFromSnapshots(metadata, null, null, unknownChecks, null)
      expect(result.checks_ref).toBeNull()
    })

    it('returns null when checks is null', () => {
      const result = buildGithubPrDataFromSnapshots(metadata, null, null, null, null)
      expect(result.checks_ref).toBeNull()
    })

    it('returns null when checkRuns is empty', () => {
      const emptyChecks: PrChecks = { conclusion: null, checkRuns: [], statuses: [] }
      const result = buildGithubPrDataFromSnapshots(metadata, null, null, emptyChecks, null)
      expect(result.checks_ref).toBeNull()
    })

    it('returns head when no check runs have headSha (older cached data — assumed branch)', () => {
      const noShaChecks: PrChecks = {
        conclusion: 'success',
        checkRuns: [makeCheckRun(), makeCheckRun()],
        statuses: [],
      }
      const result = buildGithubPrDataFromSnapshots(metadata, null, null, noShaChecks, null)
      expect(result.checks_ref).toBe('head')
    })

    it('returns null when PR has no mergeCommitSha (open PR)', () => {
      const openPrMetadata: PrMetadata = { ...metadata, mergeCommitSha: null, mergedAt: null }
      const branchChecks: PrChecks = {
        conclusion: 'success',
        checkRuns: [makeCheckRun('def456')],
        statuses: [],
      }
      const result = buildGithubPrDataFromSnapshots(openPrMetadata, null, null, branchChecks, null)
      expect(result.checks_ref).toBeNull()
    })

    it('skips check runs without headSha and uses the first one that has it', () => {
      const mixedChecks: PrChecks = {
        conclusion: 'success',
        checkRuns: [
          makeCheckRun(), // no headSha
          makeCheckRun('merge789'),
        ],
        statuses: [],
      }
      const result = buildGithubPrDataFromSnapshots(metadata, null, null, mixedChecks, null)
      expect(result.checks_ref).toBe('merge_commit')
    })
  })
})
