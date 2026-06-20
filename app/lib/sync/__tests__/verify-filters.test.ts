import { describe, expect, it } from 'vitest'
import {
  applyLimit,
  classifyCommitSha,
  filterDeploymentsForVerification,
  sortDeploymentsByAge,
} from '../verify-filters'

function makeDeployment(
  overrides: { id?: number; four_eyes_status?: string | null; created_at?: string; commit_sha?: string | null } = {},
) {
  return {
    id: 'id' in overrides ? (overrides.id as number) : 1,
    four_eyes_status:
      'four_eyes_status' in overrides ? (overrides.four_eyes_status ?? null) : ('pending' as string | null),
    created_at: overrides.created_at ?? '2026-01-15T10:00:00Z',
    commit_sha: 'commit_sha' in overrides ? (overrides.commit_sha ?? null) : ('abc123' as string | null),
  }
}

describe('filterDeploymentsForVerification', () => {
  it('includes deployments with pending status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'pending' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(1)
  })

  it('includes deployments with error status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'error' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(1)
  })

  it('excludes deployments with approved status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'approved' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(0)
  })

  it('excludes deployments with legacy status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'legacy' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(0)
  })

  it('excludes deployments with direct_push status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'direct_push' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(0)
  })

  it('excludes deployments with unverified_commits status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'unverified_commits' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(0)
  })

  it('excludes deployments with missing status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'missing' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(0)
  })

  it('excludes approved deployments with pending status', () => {
    const deps = [makeDeployment({ four_eyes_status: 'approved' })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(0)
  })

  it('excludes deployments with null status', () => {
    const deps = [makeDeployment({ four_eyes_status: null })]
    expect(filterDeploymentsForVerification(deps)).toHaveLength(0)
  })

  it('handles mixed batch correctly', () => {
    const deps = [
      makeDeployment({ id: 1, four_eyes_status: 'pending' }),
      makeDeployment({ id: 2, four_eyes_status: 'approved' }),
      makeDeployment({ id: 3, four_eyes_status: 'error' }),
      makeDeployment({ id: 4, four_eyes_status: 'legacy' }),
      makeDeployment({ id: 5, four_eyes_status: 'direct_push' }),
    ]
    const result = filterDeploymentsForVerification(deps)
    expect(result.map((d) => d.id)).toEqual([1, 3])
  })
})

describe('sortDeploymentsByAge', () => {
  it('sorts oldest first', () => {
    const deps = [
      makeDeployment({ id: 1, created_at: '2026-03-01T10:00:00Z' }),
      makeDeployment({ id: 2, created_at: '2026-01-01T10:00:00Z' }),
      makeDeployment({ id: 3, created_at: '2026-02-01T10:00:00Z' }),
    ]
    const result = sortDeploymentsByAge(deps)
    expect(result.map((d) => d.id)).toEqual([2, 3, 1])
  })

  it('does not mutate original array', () => {
    const deps = [
      makeDeployment({ id: 1, created_at: '2026-03-01T10:00:00Z' }),
      makeDeployment({ id: 2, created_at: '2026-01-01T10:00:00Z' }),
    ]
    const original = [...deps]
    sortDeploymentsByAge(deps)
    expect(deps.map((d) => d.id)).toEqual(original.map((d) => d.id))
  })

  it('handles empty array', () => {
    expect(sortDeploymentsByAge([])).toEqual([])
  })
})

describe('applyLimit', () => {
  it('returns all items when no limit', () => {
    const items = [1, 2, 3, 4, 5]
    expect(applyLimit(items)).toEqual([1, 2, 3, 4, 5])
  })

  it('returns first N items with limit', () => {
    const items = [1, 2, 3, 4, 5]
    expect(applyLimit(items, 3)).toEqual([1, 2, 3])
  })

  it('returns all items when limit exceeds length', () => {
    const items = [1, 2]
    expect(applyLimit(items, 10)).toEqual([1, 2])
  })

  it('returns empty when limit is 0', () => {
    expect(applyLimit([1, 2, 3], 0)).toEqual([1, 2, 3])
  })
})

describe('classifyCommitSha', () => {
  it('returns verify for normal SHA', () => {
    expect(classifyCommitSha('abc123def456')).toBe('verify')
  })

  it('returns skip_no_sha for null', () => {
    expect(classifyCommitSha(null)).toBe('skip_no_sha')
  })

  it('returns mark_legacy for refs/ prefix', () => {
    expect(classifyCommitSha('refs/heads/main')).toBe('mark_legacy')
  })

  it('returns mark_legacy for refs/pull/ prefix', () => {
    expect(classifyCommitSha('refs/pull/123/head')).toBe('mark_legacy')
  })

  it('returns verify for short SHA', () => {
    expect(classifyCommitSha('abc1234')).toBe('verify')
  })
})
