import { describe, expect, it } from 'vitest'
import { assessRepositoryAuditReadiness, type RepositoryAuditReportData } from '../repository-audit-report'

function report(): RepositoryAuditReportData {
  return {
    schemaVersion: 1,
    verificationSchemaVersion: 5,
    assessmentModel: 'repository',
    assessmentTime: 'generation',
    assessedAt: '2026-02-01T00:00:00Z',
    app: { id: 1, name: 'test', team: 'team-fjord', environment: 'prod-gcp' },
    period: { start: '2026-01-01T00:00:00Z', end: '2026-01-31T23:59:59Z' },
    deployments: [
      {
        id: 1,
        naisDeploymentId: 'nais-1',
        createdAt: '2026-01-15T00:00:00Z',
        commitSha: 'b'.repeat(40),
        deployerUsername: null,
        repositoryId: 5,
        deliveryId: 7,
        source: {
          branch: 'main',
          defaultBranch: 'main',
          triggerEvent: 'push',
          triggerUrl: null,
          repositoryAuthorization: { linkId: 1, status: 'active' },
          workflowSnapshot: null,
        },
      },
    ],
    deliveries: [
      {
        id: 7,
        repositoryId: 5,
        githubRepoId: '123',
        githubOwner: 'navikt',
        githubRepoName: 'test',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        interval: {
          state: 'complete',
          comparisonComplete: true,
          defaultBranch: 'main',
          totalCommits: 1,
          listedCommits: 1,
          omittedCommits: 0,
          summary: { covered: 1, notCovered: 0, unknown: 0 },
          commits: [],
        },
        assessment: { status: 'approved', totalCommits: 1, listedCommits: 1, omittedCommits: 0, commits: [] },
        evidence: {
          compare: null,
          defaultBranch: 'main',
          implicitApprovalMode: 'off',
          associatedPullRequestsByCommit: {},
          pullRequestsByNumber: {},
        },
        sources: { comparisons: [], associations: [], pullRequests: [], stackComparisons: [] },
        authorIdentities: [],
        manualApprovals: [],
      },
    ],
  }
}

describe('repository audit readiness', () => {
  it('blocks an anchor instead of treating it as approval of earlier code', () => {
    const data = report()
    data.deliveries[0].assessment.status = 'no_changes'
    const readiness = assessRepositoryAuditReadiness(data)
    expect(readiness.isReady).toBe(false)
    expect(readiness.deployments[0].blockers).toEqual(['baseline_required'])
  })

  it.each(['workflow_dispatch', 'repository_dispatch'])('blocks %s even with approved code', (trigger) => {
    const data = report()
    data.deployments[0].source.triggerEvent = trigger
    expect(assessRepositoryAuditReadiness(data).deployments[0].blockers).toEqual(['manual_trigger'])
  })

  it('retains all independent missing-source and coverage blockers', () => {
    const data = report()
    data.deployments[0].source = {
      branch: null,
      defaultBranch: null,
      triggerEvent: null,
      triggerUrl: null,
      repositoryAuthorization: null,
      workflowSnapshot: null,
    }
    data.deployments[0].deliveryId = null
    const readiness = assessRepositoryAuditReadiness(data)
    expect(readiness.isReady).toBe(false)
    expect(readiness.deployments[0].blockers).toEqual([
      'missing_link',
      'unknown_repository_authorization',
      'unknown_trigger',
      'unknown_branch',
    ])
  })

  it('blocks a non-default branch without discarding approved code coverage', () => {
    const data = report()
    data.deployments[0].source.branch = 'feature'
    expect(assessRepositoryAuditReadiness(data).deployments[0].blockers).toEqual(['unauthorized_branch'])
    expect(data.deliveries[0].assessment.status).toBe('approved')
  })

  it.each(['pending_approval', 'historical'])('blocks %s repository links despite approved code', (status) => {
    const data = report()
    data.deployments[0].source.repositoryAuthorization = { linkId: 1, status }
    expect(assessRepositoryAuditReadiness(data).deployments[0].blockers).toEqual(['unauthorized_repository'])
  })

  it('distinguishes an empty period from a period with approved deployments', () => {
    const data = report()
    data.deployments = []
    data.deliveries = []
    expect(assessRepositoryAuditReadiness(data)).toMatchObject({
      isReady: true,
      noDeployments: true,
      totalDeployments: 0,
    })
  })
})
