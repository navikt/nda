import { describe, expect, it } from 'vitest'
import { analyzeMergedPrWindow, type MergedPullRequestWindowItem } from '~/lib/verification/debug-merged-prs'

const mergedAt = '2026-04-21T10:00:00Z'

function makePr(overrides: Partial<MergedPullRequestWindowItem>): MergedPullRequestWindowItem {
  return {
    number: 100,
    title: 'feat: something',
    htmlUrl: 'https://github.com/navikt/repo/pull/100',
    mergedAt,
    baseBranch: 'main',
    headSha: 'head-sha-100',
    mergeCommitSha: 'merge-sha-100',
    authorUsername: 'dev-a',
    mergedByUsername: 'dev-b',
    ...overrides,
  }
}

describe('analyzeMergedPrWindow', () => {
  it('classifies PR as deployed_as_current_pr when current deployment has same PR number', () => {
    const result = analyzeMergedPrWindow(
      [makePr({ number: 200 })],
      { deploymentId: 10, commitSha: 'current-sha', githubPrNumber: 200 },
      [],
    )

    expect(result.summary.deliveredAsCurrentPr).toBe(1)
    expect(result.pullRequests[0].classification).toBe('deployed_as_current_pr')
    expect(result.pullRequests[0].matchedDeploymentIds).toEqual([10])
  })

  it('classifies PR as deployed_as_nearby_pr when nearby deployment has same PR number', () => {
    const result = analyzeMergedPrWindow(
      [makePr({ number: 300 })],
      { deploymentId: 10, commitSha: 'current-sha', githubPrNumber: 200 },
      [{ deploymentId: 11, commitSha: 'nearby-sha', githubPrNumber: 300 }],
    )

    expect(result.summary.deliveredAsNearbyPr).toBe(1)
    expect(result.pullRequests[0].classification).toBe('deployed_as_nearby_pr')
    expect(result.pullRequests[0].matchedDeploymentIds).toEqual([11])
  })

  it('classifies PR as deployed_by_commit_sha when merge commit matches deployment commit', () => {
    const result = analyzeMergedPrWindow(
      [makePr({ number: 400, mergeCommitSha: 'shared-sha', headSha: 'head-only-sha' })],
      { deploymentId: 10, commitSha: 'current-sha', githubPrNumber: 200 },
      [{ deploymentId: 12, commitSha: 'shared-sha', githubPrNumber: null }],
    )

    expect(result.summary.deliveredByCommitSha).toBe(1)
    expect(result.pullRequests[0].classification).toBe('deployed_by_commit_sha')
    expect(result.pullRequests[0].matchedDeploymentIds).toEqual([12])
  })

  it('classifies PR as not_observed_in_deployments when no PR/commit evidence exists', () => {
    const result = analyzeMergedPrWindow(
      [makePr({ number: 500, mergeCommitSha: 'merge-x', headSha: 'head-x' })],
      { deploymentId: 10, commitSha: 'current-sha', githubPrNumber: 200 },
      [{ deploymentId: 11, commitSha: 'nearby-sha', githubPrNumber: 201 }],
    )

    expect(result.summary.notObservedInDeployments).toBe(1)
    expect(result.pullRequests[0].classification).toBe('not_observed_in_deployments')
    expect(result.pullRequests[0].matchedDeploymentIds).toEqual([])
  })
})
