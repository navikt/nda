import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockResolveRepositoryApprovalCapabilities,
  mockGetEvidence,
  mockGetGithubUserLookups,
  mockGetHistory,
  mockClient,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockResolveRepositoryApprovalCapabilities: vi.fn(),
  mockGetEvidence: vi.fn(),
  mockGetGithubUserLookups: vi.fn(),
  mockGetHistory: vi.fn(),
  mockClient: { query: vi.fn() },
}))

vi.mock('~/db/connection.server', () => ({
  withTransaction: (operation: (client: typeof mockClient) => Promise<unknown>) => operation(mockClient),
}))
vi.mock('~/db/repository-manual-approvals.server', () => ({
  getRepositoryManualApprovalHistoryForAdmin: mockGetHistory,
}))
vi.mock('~/lib/auth.server', () => ({ requireUser: mockRequireUser }))
vi.mock('~/lib/repository-resolution.server', () => ({ resolveRepositoryFromParams: mockResolveRepositoryFromParams }))
vi.mock('~/lib/authorization.server', () => ({
  resolveRepositoryApprovalCapabilities: mockResolveRepositoryApprovalCapabilities,
}))
vi.mock('~/db/repository-code-delivery-overview.server', () => ({
  getRepositoryCodeDeliveryEvidence: mockGetEvidence,
}))
vi.mock('~/db/user-github-lookups.server', () => ({ getGithubUserLookups: mockGetGithubUserLookups }))

import { loader } from './repository.$owner.$repo.admin.code-deliveries.$deliveryId'

const params = { owner: 'navikt', repo: 'glad-fjord', deliveryId: '17' }
const repository = {
  id: 5,
  github_owner: 'navikt',
  github_repo_name: 'glad-fjord',
}
const evidence = {
  id: 17,
  base_sha: '1'.repeat(40),
  head_sha: '2'.repeat(40),
  created_at: new Date('2026-10-03T10:00:00Z'),
  page: 1,
  totalPages: 1,
  totalEvidenceEntries: 1,
  interval_assessment: {
    state: 'complete',
    comparisonComplete: true,
    defaultBranch: 'main',
    totalCommits: 1,
    listedCommits: 1,
    omittedCommits: 0,
    summary: { covered: 1, notCovered: 0, unknown: 0 },
    commits: [
      {
        sha: '2'.repeat(40),
        message: 'Add delivery evidence',
        authorUsername: 'rask-elv',
        authorLogin: 'rask-elv',
        htmlUrl: `https://github.com/navikt/glad-fjord/commit/${'2'.repeat(40)}`,
        pullRequestNumber: 42,
        status: 'covered',
        reason: 'approved_review',
      },
    ],
  },
  deployments: [
    {
      id: 23,
      deployed_at: new Date('2026-10-03T12:00:00Z'),
      team_slug: 'team-fjord',
      environment_name: 'prod-gcp',
      app_name: 'glad-fjord',
      verification_runs: [
        {
          id: 4,
          run_at: new Date('2026-10-03T12:01:00Z'),
          schema_version: 5,
          status: 'approved',
          comparison_range: { baseSha: '1'.repeat(40), headSha: '2'.repeat(40) },
          comparison_range_invalid: false,
          review_snapshots: [
            {
              id: 9,
              pr_number: 42,
              schema_version: 5,
              fetched_at: new Date('2026-10-03T12:00:00Z'),
              source: 'github',
              github_available: true,
              reviews: [
                {
                  id: 1,
                  username: 'rask-elv',
                  state: 'APPROVED',
                  submittedAt: '2026-10-03T11:00:00Z',
                  commitSha: null,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}

function makeRequest(search = '?repositoryId=5') {
  return new Request(`http://localhost/repository/navikt/glad-fjord/admin/code-deliveries/17${search}`)
}

describe('repository code delivery evidence loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveRepositoryApprovalCapabilities.mockResolvedValue({
      canApprove: false,
      canAccessAdmin: true,
      affectedApps: [],
    })
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockGetEvidence.mockResolvedValue(evidence)
    mockGetHistory.mockResolvedValue({ snapshots: [], commits: [], events: [] })
    mockGetGithubUserLookups.mockResolvedValue(
      new Map([
        [
          'rask-elv',
          {
            display_name: 'Rask Elv',
            nav_ident: 'Z990010',
            active_nav_ident: 'Z990010',
            account_deleted_at: null,
          },
        ],
      ]),
    )
  })

  it('requires repository admin access before loading evidence', async () => {
    mockResolveRepositoryApprovalCapabilities.mockResolvedValue({
      canApprove: true,
      canAccessAdmin: false,
      affectedApps: [],
    })

    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetEvidence).not.toHaveBeenCalled()
    expect(mockGetHistory).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', 'abc', '17extra', '2147483648', '9007199254740992'])(
    'rejects invalid delivery id %s',
    async (deliveryId) => {
      await expect(
        loader({
          params: { ...params, deliveryId },
          request: makeRequest(),
        } as never),
      ).rejects.toMatchObject({ status: 400 })
      expect(mockRequireUser).not.toHaveBeenCalled()
    },
  )

  it('returns evidence and evaluates PR coverage for the repository delivery', async () => {
    const result = await loader({ params, request: makeRequest() } as never)

    expect(mockResolveRepositoryFromParams).toHaveBeenCalledWith(
      'navikt',
      'glad-fjord',
      expect.any(URL),
      '/admin/code-deliveries/17',
    )
    expect(mockClient.query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(mockGetEvidence).toHaveBeenCalledWith(5, 17, 1, mockClient)
    expect(mockGetHistory).toHaveBeenCalledWith(expect.objectContaining({ navIdent: 'Z990010' }), 5, 17, mockClient)
    expect(mockGetGithubUserLookups).toHaveBeenCalledWith(['rask-elv'], mockClient)
    expect(result).toMatchObject({
      repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
      delivery: evidence,
      approvalAssessment: {
        status: 'approved',
        totalCommits: 1,
        listedCommits: 1,
        commits: [{ sha: '2'.repeat(40), status: 'covered', reason: 'approved_pr' }],
      },
      userMappings: { 'rask-elv': { display_name: 'Rask Elv', nav_ident: 'Z990010' } },
    })
  })

  it('keeps unmapped commit authors unknown', async () => {
    mockGetGithubUserLookups.mockResolvedValue(new Map())
    mockGetEvidence.mockResolvedValue({
      ...evidence,
      interval_assessment: {
        ...evidence.interval_assessment,
        commits: [
          {
            ...evidence.interval_assessment.commits[0],
            pullRequestNumber: null,
            status: 'not_covered',
            reason: 'no_associated_pull_request',
          },
        ],
      },
    })

    const result = await loader({ params, request: makeRequest() } as never)

    expect(result.approvalAssessment).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'unknown_commit_author' }],
    })
  })

  it('does not use a deleted GitHub account mapping as commit author identity', async () => {
    mockGetGithubUserLookups.mockResolvedValue(
      new Map([
        [
          'rask-elv',
          {
            display_name: 'Rask Elv',
            nav_ident: 'Z990010',
            active_nav_ident: 'Z990010',
            account_deleted_at: new Date('2026-10-17T10:00:00Z'),
          },
        ],
      ]),
    )
    mockGetEvidence.mockResolvedValue({
      ...evidence,
      interval_assessment: {
        ...evidence.interval_assessment,
        commits: [
          {
            ...evidence.interval_assessment.commits[0],
            pullRequestNumber: null,
            status: 'not_covered',
            reason: 'no_associated_pull_request',
          },
        ],
      },
    })

    const result = await loader({ params, request: makeRequest() } as never)

    expect(result.approvalAssessment).toMatchObject({
      status: 'incomplete',
      commits: [{ status: 'unknown', reason: 'unknown_commit_author' }],
    })
    expect(result.userMappings['rask-elv']).toMatchObject({
      display_name: 'Rask Elv',
      nav_ident: null,
    })
  })

  it('loads the requested evidence page', async () => {
    await loader({ params, request: makeRequest('?repositoryId=5&page=3') } as never)

    expect(mockGetEvidence).toHaveBeenCalledWith(5, 17, 3, mockClient)
  })

  it('uses admin history access for a historical repository admin without approval rights', async () => {
    const user = { navIdent: 'Z990010', role: 'user', isActualAdmin: false }
    mockRequireUser.mockResolvedValue(user)
    mockResolveRepositoryApprovalCapabilities.mockResolvedValue({
      canAccessAdmin: true,
      canApprove: false,
      affectedApps: [{ id: 9, app_name: 'flyttet-app' }],
    })
    const result = await loader({ params, request: makeRequest() } as never)
    expect(mockGetHistory).toHaveBeenCalledWith(user, 5, 17, mockClient)
    expect(result.delivery).toEqual(evidence)
    expect(result.manualApprovalHistory).toEqual([])
    expect(result.canApprove).toBe(false)
    expect(result.canRevoke).toBe(true)
    expect(mockResolveRepositoryApprovalCapabilities).toHaveBeenCalledExactlyOnceWith(user, 5)
  })

  it('returns not found if the delivery does not belong to the repository', async () => {
    mockGetEvidence.mockResolvedValue(null)

    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 404 })
    expect(mockGetGithubUserLookups).not.toHaveBeenCalled()
    expect(mockGetHistory).not.toHaveBeenCalled()
  })

  it.each([
    { manualStatus: 'eligible', prStatus: 'not_covered', expected: 'approved', reason: 'manual_approval' },
    { manualStatus: 'revoked', prStatus: 'not_covered', expected: 'not_approved', reason: 'missing_approval' },
    {
      manualStatus: 'identity_or_interval_changed',
      prStatus: 'not_covered',
      expected: 'not_approved',
      reason: 'missing_approval',
    },
    { manualStatus: 'eligible', prStatus: 'unknown', expected: 'incomplete', reason: 'unknown_pr_coverage' },
    { manualStatus: 'revoked', prStatus: 'covered', expected: 'approved', reason: 'approved_pr' },
    {
      manualStatus: 'eligible',
      prStatus: 'not_covered',
      expected: 'not_approved',
      reason: 'missing_approval',
      storedAuthor: 'stille-skog',
    },
    {
      manualStatus: 'eligible',
      prStatus: 'not_covered',
      expected: 'not_approved',
      reason: 'missing_approval',
      storedNavIdent: 'Z990002',
    },
    {
      manualStatus: 'eligible',
      prStatus: 'not_covered',
      expected: 'incomplete',
      reason: 'incomplete_commit_history',
      comparisonComplete: false,
    },
  ])(
    'combines $manualStatus manual approval and $prStatus PR coverage',
    async ({
      manualStatus,
      prStatus,
      expected,
      reason,
      storedAuthor = 'rask-elv',
      storedNavIdent = 'Z990010',
      comparisonComplete = true,
    }) => {
      const reviewedAt = new Date('2026-10-18T10:00:00Z')
      const registeredAt = new Date('2026-10-18T11:00:00Z')
      mockGetEvidence.mockResolvedValue({
        ...evidence,
        interval_assessment: {
          ...evidence.interval_assessment,
          comparisonComplete,
          commits: [{ ...evidence.interval_assessment.commits[0], status: prStatus }],
        },
      })
      mockGetHistory.mockResolvedValue({
        snapshots: [
          {
            id: 31,
            base_sha: evidence.base_sha,
            head_sha: evidence.head_sha,
            evidence: { private: 'raw evidence must not reach the client' },
            evidence_hash: 'internal',
          },
        ],
        commits: [
          {
            id: 41,
            snapshot_id: 31,
            reviewer_nav_ident: 'Z990001',
            registered_by_nav_ident: 'Z990001',
            reviewed_at: reviewedAt,
            registered_at: registeredAt,
            sha: evidence.head_sha,
            author_login: storedAuthor,
            author_nav_ident: storedNavIdent,
            status: manualStatus,
          },
        ],
        events: [
          {
            id: 51,
            approval_id: 41,
            event_type: 'created',
            actor_nav_ident: 'Z990001',
            reason: null,
            created_at: registeredAt,
          },
        ],
      })
      const result = await loader({ params, request: makeRequest() } as never)
      expect(result.approvalAssessment).toMatchObject({
        status: expected,
        commits: [{ sha: evidence.head_sha, reason }],
      })
      expect(result.manualApprovalHistory).toEqual([
        {
          id: 41,
          reviewDocumentation: null,
          documentationUrl: null,
          reviewer: 'Z990001',
          registeredBy: 'Z990001',
          reviewedAt,
          registeredAt,
          baseSha: evidence.base_sha,
          headSha: evidence.head_sha,
          commits: [
            { sha: evidence.head_sha, authorLogin: storedAuthor, authorNavIdent: storedNavIdent, status: manualStatus },
          ],
          events: [{ type: 'created', actor: 'Z990001', reason: null, at: registeredAt }],
        },
      ])
      expect(JSON.stringify(result)).not.toContain('raw evidence')
      expect(JSON.stringify(result)).not.toContain('evidence_hash')
    },
  )
})
