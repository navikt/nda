import type { RepositoryAuditReportData } from '../../repository-audit-report'
import type { RepositoryReportOutputProps } from '../../repository-audit-report-output'

export function repositoryReportFixture(): RepositoryReportOutputProps {
  const headSha = 'b'.repeat(40)
  const data: RepositoryAuditReportData = {
    schemaVersion: 1,
    verificationSchemaVersion: 5,
    assessmentModel: 'repository',
    assessmentTime: 'generation',
    assessedAt: '2026-02-01T00:00:00Z',
    app: { id: 1, name: 'test', team: 'team-fjord', environment: 'prod-gcp' },
    period: { start: '2026-01-01T00:00:00Z', end: '2026-01-31T23:59:59Z' },
    deployments: [1, 2].map((id) => ({
      id,
      naisDeploymentId: `nais-${id}`,
      createdAt: `2026-01-${14 + id}T00:00:00Z`,
      commitSha: headSha,
      deployerUsername: 'gladfjord',
      repositoryId: 5,
      deliveryId: 7,
      source: {
        branch: 'main',
        defaultBranch: 'main',
        triggerEvent: 'push',
        triggerUrl: 'https://github.com/navikt/test/actions/runs/1',
        repositoryAuthorization: { linkId: 1, status: 'active' },
        workflowSnapshot: { id: 50, fetchedAt: '2026-01-16T01:00:00Z', runId: 1, runAttempt: 1 },
      },
    })),
    deliveries: [
      {
        id: 7,
        repositoryId: 5,
        githubRepoId: '123',
        githubOwner: 'navikt',
        githubRepoName: 'test',
        baseSha: 'a'.repeat(40),
        headSha,
        interval: {
          state: 'complete',
          comparisonComplete: true,
          defaultBranch: 'main',
          totalCommits: 1,
          listedCommits: 1,
          omittedCommits: 0,
          summary: { covered: 0, notCovered: 1, unknown: 0 },
          commits: [
            {
              sha: headSha,
              message: 'Rett visning',
              authorUsername: 'gladfjord',
              authorLogin: 'gladfjord',
              htmlUrl: `https://github.com/navikt/test/commit/${headSha}`,
              pullRequestNumber: null,
              status: 'not_covered',
              reason: 'no_associated_pull_request',
            },
          ],
        },
        assessment: {
          status: 'approved',
          totalCommits: 1,
          listedCommits: 1,
          omittedCommits: 0,
          commits: [{ sha: headSha, status: 'covered', reason: 'manual_approval' }],
        },
        evidence: {
          compare: null,
          defaultBranch: 'main',
          implicitApprovalMode: 'off',
          associatedPullRequestsByCommit: {},
          pullRequestsByNumber: {},
        },
        sources: {
          comparisons: [{ id: 10, fetchedAt: '2026-01-16T01:00:00Z' }],
          associations: [],
          pullRequests: [],
          stackComparisons: [],
        },
        authorIdentities: [],
        manualApprovals: [
          {
            id: 20,
            snapshotId: 30,
            sha: headSha,
            authorLogin: 'gladfjord',
            authorNavIdent: 'Z990001',
            reviewerNavIdent: 'Z990002',
            registeredByNavIdent: 'Z990003',
            reviewedAt: '2026-01-20T00:00:00Z',
            registeredAt: '2026-01-21T00:00:00Z',
            documentation: 'Kontrollert av Rask Elv',
            status: 'eligible',
          },
        ],
      },
    ],
  }
  return {
    appName: data.app.name,
    teamSlug: data.app.team,
    environmentName: data.app.environment,
    periodLabel: 'Januar 2026',
    periodStart: new Date(data.period.start),
    periodEnd: new Date(data.period.end),
    reportData: data,
    reportId: 'repository-test',
    contentHash: 'c'.repeat(64),
    generatedAt: new Date(data.assessedAt),
  }
}
