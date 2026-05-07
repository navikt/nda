import { describe, expect, it, vi } from 'vitest'
import { extractCommitInfos } from '~/lib/sync/github-verify.server'

vi.mock('~/db/connection.server', () => ({ pool: { query: vi.fn() } }))
vi.mock('~/db/deployments.server', () => ({
  getAllDeployments: vi.fn(),
  getDeploymentById: vi.fn(),
  updateDeploymentFourEyes: vi.fn(),
}))
vi.mock('~/lib/verification', () => ({ runVerification: vi.fn() }))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/sync/goal-keyword-sync.server', () => ({
  autoLinkGoalKeywords: vi.fn(),
  autoLinkDependabotGoal: vi.fn(),
}))

describe('extractCommitInfos', () => {
  it('includes PR title as commit info', () => {
    const result = extractCommitInfos({
      title: 'feat: add new feature',
      created_at: '2026-02-15T10:00:00Z',
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('feat: add new feature')
  })

  it('includes head_branch from github_pr_data', () => {
    const result = extractCommitInfos({
      title: null,
      created_at: '2026-02-15T10:00:00Z',
      github_pr_data: {
        head_branch: 'sp-bau/refactor-components',
      },
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('sp-bau/refactor-components')
  })

  it('includes both title and branch name', () => {
    const result = extractCommitInfos({
      title: 'fix: something',
      created_at: '2026-02-15T10:00:00Z',
      github_pr_data: {
        head_branch: 'sp-bau/fix-something',
        commits: [{ message: 'commit 1' }],
      },
    })
    const messages = result.map((r) => r.message)
    expect(messages).toContain('fix: something')
    expect(messages).toContain('sp-bau/fix-something')
    expect(messages).toContain('commit 1')
  })

  it('skips branch name when head_branch is undefined', () => {
    const result = extractCommitInfos({
      title: 'fix: something',
      created_at: '2026-02-15T10:00:00Z',
      github_pr_data: {
        commits: [{ message: 'commit 1' }],
      },
    })
    expect(result).toHaveLength(2)
  })

  it('includes unverified commits', () => {
    const result = extractCommitInfos({
      created_at: '2026-02-15T10:00:00Z',
      unverified_commits: [{ message: 'unverified fix', date: '2026-02-14T10:00:00Z' }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].message).toBe('unverified fix')
  })
})
