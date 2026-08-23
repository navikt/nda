import { describe, expect, it } from 'vitest'
import { mapCompareResponse, type RawCompareResponse } from '../github/compare-snapshot'

function makeCompareResponse(overrides: Record<string, unknown> = {}): RawCompareResponse {
  return {
    status: 'ahead',
    ahead_by: 2,
    behind_by: 0,
    total_commits: 2,
    files: [{ filename: 'app/foo.ts' }, { filename: 'app/bar.ts' }],
    commits: [
      {
        sha: 'aaa111',
        html_url: 'https://github.com/commit/aaa111',
        author: { login: 'developer-a' },
        parents: [{ sha: 'parent1' }],
        commit: {
          message: 'Fix bug',
          author: { name: 'Developer A', date: '2026-02-20T11:00:00Z' },
          committer: { date: '2026-02-20T11:05:00Z' },
        },
      },
      {
        sha: 'bbb222',
        html_url: 'https://github.com/commit/bbb222',
        author: null,
        parents: [{ sha: 'parent1' }, { sha: 'parent2' }],
        commit: {
          message: 'Merge branch',
          author: { name: 'Developer B', date: '2026-02-20T12:00:00Z' },
          committer: null,
        },
      },
    ],
    ...overrides,
  } as unknown as RawCompareResponse
}

describe('mapCompareResponse', () => {
  it('maps compare summary fields', () => {
    const result = mapCompareResponse(makeCompareResponse())

    expect(result.compare).toEqual({
      status: 'ahead',
      aheadBy: 2,
      behindBy: 0,
      totalCommits: 2,
      changedFiles: 2,
      noDiffDetected: false,
    })
  })

  it('maps commit fields and detects merge commits from multiple parents', () => {
    const result = mapCompareResponse(makeCompareResponse())

    expect(result.commits[0]).toEqual({
      sha: 'aaa111',
      message: 'Fix bug',
      authorUsername: 'developer-a',
      authorDate: '2026-02-20T11:00:00Z',
      committerDate: '2026-02-20T11:05:00Z',
      htmlUrl: 'https://github.com/commit/aaa111',
      isMergeCommit: false,
      parentShas: ['parent1'],
    })

    expect(result.commits[1]).toEqual({
      sha: 'bbb222',
      message: 'Merge branch',
      authorUsername: 'Developer B',
      authorDate: '2026-02-20T12:00:00Z',
      committerDate: '2026-02-20T12:00:00Z',
      htmlUrl: 'https://github.com/commit/bbb222',
      isMergeCommit: true,
      parentShas: ['parent1', 'parent2'],
    })
  })

  it('handles empty commits and files arrays', () => {
    const result = mapCompareResponse(makeCompareResponse({ commits: [], files: [] }))

    expect(result.commits).toEqual([])
    expect(result.compare.changedFiles).toBe(0)
  })
})
