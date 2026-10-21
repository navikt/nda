import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepositoryAuditReportData } from '~/lib/repository-audit-report'
import { assessStoredRepositoryDeliveryApproval } from '~/lib/repository-code-delivery/approval-assessment'

const { query, getIntervals, getHistory, getLookups } = vi.hoisted(() => ({
  query: vi.fn(),
  getIntervals: vi.fn(),
  getHistory: vi.fn(),
  getLookups: vi.fn(),
}))
vi.mock('../connection.server', () => ({
  withTransaction: (read: (client: { query: typeof query }) => Promise<unknown>) => read({ query }),
}))
vi.mock('../repository-code-delivery-interval-assessment.server', () => ({
  getRepositoryCodeDeliveryIntervalAssessments: getIntervals,
}))
vi.mock('../repository-manual-approval-commits.server', () => ({
  getRepositoryManualApprovalCommits: getHistory,
}))
vi.mock('../user-github-lookups.server', () => ({ getGithubUserLookups: getLookups }))

import { getRepositoryAuditReportData } from '../audit-reports/repository-data.server'

const baseSha = 'a'.repeat(40)
const prSha = 'b'.repeat(40)
const headSha = 'c'.repeat(40)
const periodStart = new Date('2026-01-01T00:00:00Z')
const periodEnd = new Date('2026-01-31T23:59:59.999Z')
const assessedAt = new Date('2026-02-10T12:00:00Z')

function deployment(id = 1) {
  return {
    id,
    nais_deployment_id: `nais-${id}`,
    created_at: new Date('2026-01-15T12:00:00Z'),
    commit_sha: headSha,
    deployer_username: 'glad-fjord',
    repository_id: 5,
    repository_code_delivery_id: 7,
    branch_name: 'main',
    default_branch: 'main',
    trigger_event: 'push',
    trigger_url: 'https://github.com/navikt/test/actions/runs/1',
    delivery_repository_id: 5,
    base_sha: baseSha,
    head_sha: headSha,
    github_repo_id: '123',
    github_owner: 'navikt',
    github_repo_name: 'test',
    detected_github_owner: 'navikt',
    detected_github_repo_name: 'test',
    authorization_link_id: 10,
    authorization_status: 'active',
  }
}

function workflowSnapshot() {
  return {
    id: 50,
    fetched_at: assessedAt,
    data: {
      id: 1,
      repository: { id: 123 },
      head_sha: headSha,
      head_branch: 'main',
      event: 'push',
      run_attempt: 1,
    },
  }
}

function evaluatedInterval() {
  const commits: RepositoryAuditReportData['deliveries'][number]['interval']['commits'] = [
    {
      sha: prSha,
      message: 'Endring via PR',
      authorUsername: 'glad-fjord',
      authorLogin: 'glad-fjord',
      htmlUrl: '',
      pullRequestNumber: 42,
      status: 'covered',
      reason: 'approved_review',
    },
    {
      sha: headSha,
      message: 'Direkte endring',
      authorUsername: 'glad-fjord',
      authorLogin: 'glad-fjord',
      htmlUrl: '',
      pullRequestNumber: null,
      status: 'not_covered',
      reason: 'no_associated_pull_request',
    },
  ]
  return {
    deliveryId: 7,
    assessment: {
      state: 'complete',
      comparisonComplete: true,
      defaultBranch: 'main',
      totalCommits: 2,
      listedCommits: 2,
      omittedCommits: 0,
      summary: { covered: 1, notCovered: 1, unknown: 0 },
      commits,
    },
    evidence: {
      compare: null,
      defaultBranch: 'main',
      implicitApprovalMode: 'off',
      associatedPullRequestsByCommit: {},
      pullRequestsByNumber: {},
    },
    sources: {
      comparisons: [{ id: 11, fetchedAt: '2026-02-09T12:00:00Z' }],
      associations: [],
      pullRequests: [],
      stackComparisons: [],
    },
  }
}

function approval() {
  return {
    delivery_id: 7,
    id: 8,
    snapshot_id: 9,
    reviewer_nav_ident: 'Z990002',
    registered_by_nav_ident: 'Z990002',
    reviewed_at: new Date('2026-02-01T12:00:00Z'),
    registered_at: new Date('2026-02-01T12:01:00Z'),
    review_documentation: 'Etterkontroll av endringen',
    sha: headSha,
    author_login: 'glad-fjord',
    author_nav_ident: 'Z990001',
    status: 'eligible',
  }
}

describe('repository audit report data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM monitored_applications WHERE')
        ? [{ app_name: 'test', team_slug: 'team-fjord', environment_name: 'prod-gcp', assessed_at: assessedAt }]
        : sql.includes('FROM deployments d')
          ? [deployment(), deployment(2)]
          : sql.includes('FROM github_workflow_runs_raw_snapshots')
            ? [workflowSnapshot()]
            : [],
    }))
    getIntervals.mockResolvedValue([evaluatedInterval()])
    getHistory.mockResolvedValue([approval()])
    getLookups.mockResolvedValue(
      new Map([
        [
          'glad-fjord',
          {
            github_username: 'glad-fjord',
            active_nav_ident: 'Z990001',
            account_identity_version: '10',
            user_identity_version: '20',
            account_deleted_at: null,
          },
        ],
      ]),
    )
  })

  it('freezes mixed PR/manual coverage once per linked delivery, including post-deployment approval', async () => {
    const { reportData, readiness } = await getRepositoryAuditReportData(3, periodStart, periodEnd)
    expect(readiness.isReady).toBe(true)
    expect(reportData.deployments).toHaveLength(2)
    expect(reportData.deliveries).toHaveLength(1)
    expect(reportData).toMatchObject({
      assessmentModel: 'repository',
      assessmentTime: 'generation',
      assessedAt: assessedAt.toISOString(),
      deliveries: [
        {
          id: 7,
          repositoryId: 5,
          githubRepoId: '123',
          baseSha,
          headSha,
          assessment: {
            status: 'approved',
            commits: [
              { sha: prSha, reason: 'approved_pr' },
              { sha: headSha, reason: 'manual_approval' },
            ],
          },
          manualApprovals: [
            {
              id: 8,
              snapshotId: 9,
              reviewedAt: '2026-02-01T12:00:00.000Z',
              registeredAt: '2026-02-01T12:01:00.000Z',
              reviewerNavIdent: 'Z990002',
              status: 'eligible',
            },
          ],
          authorIdentities: [{ githubUsername: 'glad-fjord', activeNavIdent: 'Z990001', accountIdentityVersion: '10' }],
          sources: { comparisons: [{ id: 11, fetchedAt: '2026-02-09T12:00:00Z' }] },
        },
      ],
    })
    expect(JSON.parse(JSON.stringify(reportData))).toEqual(reportData)
    const delivery = reportData.deliveries[0]
    const replay = assessStoredRepositoryDeliveryApproval(
      { base_sha: delivery.baseSha, head_sha: delivery.headSha },
      delivery.interval,
      delivery.manualApprovals.map((a) => ({
        sha: a.sha,
        status: a.status,
        author_login: a.authorLogin,
        author_nav_ident: a.authorNavIdent,
        reviewer_nav_ident: a.reviewerNavIdent,
      })),
      new Map(
        delivery.authorIdentities.map((identity) => [
          identity.githubUsername,
          identity.accountDeletedAt === null ? identity.activeNavIdent : null,
        ]),
      ),
    )
    expect(replay).toEqual(delivery.assessment)
    expect(getIntervals).toHaveBeenCalledExactlyOnceWith(5, [{ id: 7, base_sha: baseSha, head_sha: headSha }], {
      query,
    })
    expect(getHistory).toHaveBeenCalledWith({ query }, 5, [7])
    expect(getLookups).toHaveBeenCalledWith(['glad-fjord'], { query })
    expect(query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  })

  it('keeps missing links without looking up a same-SHA candidate', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM monitored_applications WHERE')
        ? [{ app_name: 'test', team_slug: 'team-fjord', environment_name: 'prod-gcp', assessed_at: assessedAt }]
        : sql.includes('FROM deployments d')
          ? [{ ...deployment(), repository_code_delivery_id: null }]
          : sql.includes('FROM github_workflow_runs_raw_snapshots')
            ? [workflowSnapshot()]
            : [],
    }))
    const result = await getRepositoryAuditReportData(3, periodStart, periodEnd)
    expect(result.reportData.deployments).toHaveLength(1)
    expect(result.reportData.deliveries).toEqual([])
    expect(result.readiness.deployments[0].blockers).toEqual(['missing_link'])
    expect(getIntervals).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'identity_or_interval_changed'])(
    'excludes %s manual coverage but retains its history',
    async (status) => {
      getHistory.mockResolvedValue([{ ...approval(), status }])
      const result = await getRepositoryAuditReportData(3, periodStart, periodEnd)
      expect(result.reportData.deliveries[0].assessment.status).toBe('not_approved')
      expect(result.reportData.deliveries[0].manualApprovals[0].status).toBe(status)
      expect(result.readiness.deployments[0].blockers).toEqual(['missing_approval'])
    },
  )

  it('does not turn unknown PR coverage into manual approval', async () => {
    const interval = evaluatedInterval()
    interval.assessment.commits[1] = {
      ...interval.assessment.commits[1],
      status: 'unknown',
      reason: 'missing_pull_request_snapshot',
    }
    getIntervals.mockResolvedValue([interval])
    const result = await getRepositoryAuditReportData(3, periodStart, periodEnd)
    expect(result.readiness.deployments[0].blockers).toEqual(['incomplete_coverage'])
  })

  it('uses the deployment workflow branch rather than the saved PR head branch', async () => {
    const existing = query.getMockImplementation()
    query.mockImplementation(async (sql: string) =>
      sql.includes('FROM deployments d')
        ? { rows: [{ ...deployment(), branch_name: 'feature/change' }] }
        : existing?.(sql),
    )
    const result = await getRepositoryAuditReportData(3, periodStart, periodEnd)
    expect(result.readiness.isReady).toBe(true)
    expect(result.reportData.deployments[0].source).toMatchObject({
      branch: 'main',
      workflowSnapshot: { id: 50, runId: 1, runAttempt: 1 },
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM github_workflow_runs_raw_snapshots'), [
      '123',
      1,
      null,
    ])
  })

  it.each(['pending_approval', null])(
    'blocks repository authorization %s independently of approved code',
    async (status) => {
      const existing = query.getMockImplementation()
      query.mockImplementation(async (sql: string) =>
        sql.includes('FROM deployments d')
          ? {
              rows: [
                { ...deployment(), authorization_link_id: status === null ? null : 10, authorization_status: status },
              ],
            }
          : existing?.(sql),
      )
      const result = await getRepositoryAuditReportData(3, periodStart, periodEnd)
      expect(result.reportData.deliveries[0].assessment.status).toBe('approved')
      expect(result.readiness.deployments[0].blockers).toEqual([
        status === null ? 'unknown_repository_authorization' : 'unauthorized_repository',
      ])
    },
  )

  it('selects the explicitly referenced workflow attempt and rejects another attempt', async () => {
    const existing = query.getMockImplementation()
    query.mockImplementation(async (sql: string) =>
      sql.includes('FROM deployments d')
        ? { rows: [{ ...deployment(), trigger_url: 'https://github.com/navikt/test/actions/runs/1/attempts/2' }] }
        : existing?.(sql),
    )
    const missingAttempt = await getRepositoryAuditReportData(3, periodStart, periodEnd)
    expect(missingAttempt.readiness.deployments[0].blockers).toEqual(['unknown_trigger', 'unknown_branch'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM github_workflow_runs_raw_snapshots'), [
      '123',
      1,
      '2',
    ])
    const sourceQuery = query.getMockImplementation()
    query.mockImplementation(async (sql: string) =>
      sql.includes('FROM github_workflow_runs_raw_snapshots')
        ? { rows: [{ ...workflowSnapshot(), data: { ...workflowSnapshot().data, run_attempt: 2 } }] }
        : sourceQuery?.(sql),
    )
    const matchingAttempt = await getRepositoryAuditReportData(3, periodStart, periodEnd)
    expect(matchingAttempt.readiness.isReady).toBe(true)
    expect(matchingAttempt.reportData.deployments[0].source.workflowSnapshot?.runAttempt).toBe(2)
  })

  it.each([
    null,
    { ...workflowSnapshot(), data: { ...workflowSnapshot().data, head_sha: baseSha } },
    { ...workflowSnapshot(), data: { ...workflowSnapshot().data, repository: { id: 456 } } },
    { ...workflowSnapshot(), data: { ...workflowSnapshot().data, id: 2 } },
  ])(
    'does not fall back to PR branch or cached trigger for missing or mismatched workflow evidence %#',
    async (snapshot) => {
      const existing = query.getMockImplementation()
      query.mockImplementation(async (sql: string) =>
        sql.includes('FROM github_workflow_runs_raw_snapshots')
          ? { rows: snapshot ? [snapshot] : [] }
          : existing?.(sql),
      )
      const result = await getRepositoryAuditReportData(3, periodStart, periodEnd)
      expect(result.readiness.deployments[0].blockers).toEqual(['unknown_trigger', 'unknown_branch'])
      expect(result.reportData.deployments[0].source.workflowSnapshot).toBeNull()
    },
  )

  it('fails explicitly for an inconsistent repository link', async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('FROM monitored_applications WHERE')
        ? [{ app_name: 'test', team_slug: 'team-fjord', environment_name: 'prod-gcp', assessed_at: assessedAt }]
        : sql.includes('FROM deployments d')
          ? [{ ...deployment(), delivery_repository_id: 6 }]
          : [],
    }))
    await expect(getRepositoryAuditReportData(3, periodStart, periodEnd)).rejects.toThrow('inconsistent')
    expect(getIntervals).not.toHaveBeenCalled()
  })
})
