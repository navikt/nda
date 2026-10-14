import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetGitHubClient,
  mockGetRateLimitRemaining,
  mockGetRateLimitError,
  mockListReviews,
  mockListJobs,
  mockListJobsForAttempt,
  mockGetWorkflowRun,
  mockGetPrRawSnapshotsByRepoId,
  mockSavePrRawSnapshots,
  mockGetWorkflowJobsSnapshot,
  mockSaveWorkflowJobsSnapshot,
} = vi.hoisted(() => ({
  mockGetGitHubClient: vi.fn(),
  mockGetRateLimitRemaining: vi.fn(),
  mockGetRateLimitError: vi.fn(),
  mockListReviews: vi.fn(),
  mockListJobs: vi.fn(),
  mockListJobsForAttempt: vi.fn(),
  mockGetWorkflowRun: vi.fn(),
  mockGetPrRawSnapshotsByRepoId: vi.fn(),
  mockSavePrRawSnapshots: vi.fn(),
  mockGetWorkflowJobsSnapshot: vi.fn(),
  mockSaveWorkflowJobsSnapshot: vi.fn(),
}))

vi.mock('~/lib/github/client.server', () => ({
  GITHUB_RATE_LIMIT_SAFETY_BUFFER: 200,
  getGitHubClient: mockGetGitHubClient,
  getGitHubRateLimitError: mockGetRateLimitError,
  getGitHubRateLimitRemaining: mockGetRateLimitRemaining,
}))

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrRawSnapshotsByRepositoryId: mockGetPrRawSnapshotsByRepoId,
  savePrRawSnapshotsBatch: mockSavePrRawSnapshots,
  getLatestWorkflowJobsRawSnapshot: mockGetWorkflowJobsSnapshot,
  saveWorkflowJobsRawSnapshot: mockSaveWorkflowJobsSnapshot,
}))

import type {
  RepositoryCodeDeliveryExportRow,
  RepositoryGitHubPrSnapshotExportRow,
  RepositoryVerificationRunExportRow,
  RepositoryWorkflowRunSnapshotExportRow,
} from '~/db/repository-code-delivery-overview.server'
import { fetchRepositoryDiagnosticGitHubEvidence } from '~/lib/github/repository-diagnostic-evidence.server'

function makeDeployment(deploymentId: number, githubPrNumber: number | null): RepositoryCodeDeliveryExportRow {
  return {
    deployment_id: deploymentId,
    nais_deployment_id: `deploy-${deploymentId}`,
    deployed_at: new Date('2026-10-14T10:00:00Z'),
    team_slug: 'team-fjord',
    app_name: 'glad-fjord',
    environment_name: 'prod-gcp',
    deployed_sha: 'a'.repeat(40),
    branch_name: 'main',
    trigger_url: null,
    github_pr_number: githubPrNumber,
    delivery_id: null,
    delivery_base_sha: null,
    delivery_head_sha: null,
    delivery_registered_at: null,
    delivery_first_deployed_at: null,
    unresolved_reason: null,
    unresolved_first_seen_at: null,
    unresolved_last_attempt_at: null,
    unresolved_resolved_at: null,
    tracking_since: null,
    default_branch: 'main',
  }
}

function makeInput(): {
  owner: string
  repo: string
  githubRepoId: string
  repositoryAliases: Array<{ owner: string; repo: string }>
  deployments: RepositoryCodeDeliveryExportRow[]
  verificationRuns: RepositoryVerificationRunExportRow[]
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[]
  workflowRunSnapshots: RepositoryWorkflowRunSnapshotExportRow[]
} {
  return {
    owner: 'navikt',
    repo: 'glad-fjord',
    githubRepoId: '67890',
    repositoryAliases: [],
    deployments: [makeDeployment(10, 100)],
    verificationRuns: [
      {
        id: 20,
        deployment_id: 10,
        run_at: new Date('2026-10-14T10:00:00Z'),
        schema_version: 3,
        pr_snapshot_ids: [30],
        commit_snapshot_ids: [],
        result: {
          deployedPr: { number: 82 },
          unverifiedCommits: [{ prNumber: 82 }],
        },
        status: 'unverified_commits',
      },
    ] satisfies RepositoryVerificationRunExportRow[],
    prSnapshots: [
      {
        id: 30,
        owner: 'navikt',
        repo: 'glad-fjord',
        pr_number: 101,
        schema_version: 1,
        fetched_at: new Date('2026-10-14T10:00:00Z'),
        data_type: 'reviews',
        source: 'github',
        github_available: true,
        data: [],
      },
    ] satisfies RepositoryGitHubPrSnapshotExportRow[],
    workflowRunSnapshots: [
      {
        id: 40,
        run_id: '12345',
        github_repo_id: '67890',
        owner: 'navikt',
        repo: 'glad-fjord',
        api_version: '2022-11-28',
        api_deprecated_at: null,
        api_sunset_at: null,
        fetched_at: new Date('2026-10-14T10:00:00Z'),
        data: { display_title: 'Bump glob from 10.4.5 to 10.5.0 (#80)', pull_requests: [] },
      },
    ] satisfies RepositoryWorkflowRunSnapshotExportRow[],
  }
}

describe('fetchRepositoryDiagnosticGitHubEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRateLimitRemaining.mockReturnValue(null)
    mockGetRateLimitError.mockReturnValue(null)
    mockGetPrRawSnapshotsByRepoId.mockResolvedValue(new Map())
    mockSavePrRawSnapshots.mockResolvedValue([1])
    mockGetWorkflowJobsSnapshot.mockResolvedValue(null)
    mockSaveWorkflowJobsSnapshot.mockResolvedValue(1)
    mockGetWorkflowRun.mockResolvedValue({
      data: { status: 'completed', run_attempt: 1, repository: { id: 67890 } },
      headers: {},
    })
    mockListReviews.mockResolvedValue({
      data: [
        {
          id: 9,
          user: { login: 'RaskElv' },
          state: 'APPROVED',
          submitted_at: '2026-01-01T00:00:00Z',
          commit_id: 'b'.repeat(40),
          html_url: 'https://github.com/review/9',
        },
      ],
    })
    mockListJobs.mockResolvedValue({
      data: {
        total_count: 1,
        jobs: [
          {
            id: 50,
            name: 'deploy (prod)',
            run_attempt: 1,
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-01-02T00:00:00Z',
            completed_at: '2026-01-02T00:01:00Z',
            html_url: 'https://github.com/job/50',
            steps: [
              {
                name: 'Deploy',
                status: 'completed',
                conclusion: 'success',
                number: 1,
                started_at: '2026-01-02T00:00:30Z',
                completed_at: '2026-01-02T00:01:00Z',
              },
            ],
          },
        ],
      },
    })
    mockListJobsForAttempt.mockResolvedValue({
      data: {
        total_count: 1,
        jobs: [
          {
            id: 51,
            name: 'deploy (prod)',
            run_attempt: 2,
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-01-02T00:00:00Z',
            completed_at: '2026-01-02T00:01:00Z',
            html_url: 'https://github.com/job/51',
            steps: [],
          },
        ],
      },
    })
    const client = {
      pulls: {
        get: vi.fn(async ({ pull_number }: { pull_number: number }) => ({
          data: {
            html_url: `https://github.com/navikt/glad-fjord/pull/${pull_number}`,
            title: `PR ${pull_number}`,
            state: 'closed',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            closed_at: '2026-01-02T00:00:00Z',
            merged_at: '2026-01-02T00:00:00Z',
            merge_commit_sha: 'a'.repeat(40),
            merged_by: { login: 'reviewer' },
            head: { sha: 'b'.repeat(40) },
            base: { sha: 'c'.repeat(40), repo: { id: 67890 } },
          },
        })),
        listReviews: mockListReviews,
      },
      actions: {
        getWorkflowRun: mockGetWorkflowRun,
        listJobsForWorkflowRun: mockListJobs,
        listJobsForWorkflowRunAttempt: mockListJobsForAttempt,
      },
    }
    mockGetGitHubClient.mockReturnValue(client)
  })

  it('fetches unique PR histories and workflow jobs from generic repository evidence', async () => {
    const result = await fetchRepositoryDiagnosticGitHubEvidence(makeInput())

    expect(result.status).toBe('complete')
    expect(result.pullRequests.map((pr) => pr.number)).toEqual([100, 82, 101, 80])
    expect(result.pullRequests[1]).toMatchObject({
      status: 'available',
      pullRequest: {
        mergedAt: '2026-01-02T00:00:00Z',
        mergedBy: 'reviewer',
        mergeCommitSha: 'a'.repeat(40),
      },
      reviews: [{ reviewer: 'RaskElv', state: 'APPROVED', submittedAt: '2026-01-01T00:00:00Z' }],
    })
    expect(result.pullRequests[2]?.references).toContainEqual({
      type: 'verification_pr_snapshot',
      deploymentId: 10,
      snapshotId: 30,
    })
    expect(result.workflowRuns[0]).toMatchObject({
      runId: '12345',
      attemptNumber: null,
      snapshotIds: [40],
      deploymentIds: [],
      status: 'available',
      jobs: [
        {
          name: 'deploy (prod)',
          runAttempt: 1,
          conclusion: 'success',
          steps: [{ name: 'Deploy', conclusion: 'success' }],
        },
      ],
    })
    expect(mockListReviews).toHaveBeenCalledTimes(4)
    expect(mockListReviews).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'navikt', repo: 'glad-fjord', pull_number: 82, page: 1, per_page: 100 }),
    )
    expect(mockListJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'navikt',
        repo: 'glad-fjord',
        run_id: 12345,
        page: 1,
        per_page: 100,
        filter: 'all',
      }),
    )
    expect(mockSavePrRawSnapshots).toHaveBeenCalled()
    expect(mockGetPrRawSnapshotsByRepoId).toHaveBeenCalledWith('67890', 100)
    expect(mockSaveWorkflowJobsSnapshot).toHaveBeenCalledWith(
      'navikt',
      'glad-fjord',
      '67890',
      12345,
      null,
      expect.any(Array),
      expect.any(Object),
    )
  })

  it('reuses PR and workflow-job snapshots without making GitHub requests', async () => {
    const fetchedAt = new Date()
    const input = makeInput()
    input.workflowRunSnapshots[0].data = { status: 'completed' }
    mockGetPrRawSnapshotsByRepoId.mockResolvedValue(
      new Map([
        [
          'pr',
          {
            fetchedAt,
            data: {
              html_url: 'https://github.com/navikt/glad-fjord/pull/100',
              title: 'Cached PR',
              state: 'closed',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              closed_at: '2026-01-02T00:00:00Z',
              merged_at: '2026-01-02T00:00:00Z',
              merge_commit_sha: 'a'.repeat(40),
              merged_by: { login: 'reviewer' },
              head: { sha: 'b'.repeat(40) },
              base: { sha: 'c'.repeat(40), repo: { id: 67890 } },
            },
          },
        ],
        [
          'reviews',
          {
            fetchedAt,
            data: [
              {
                id: 9,
                user: { login: 'CachedReviewer' },
                state: 'APPROVED',
                submitted_at: '2026-01-01T00:00:00Z',
                commit_id: 'b'.repeat(40),
                html_url: 'https://github.com/review/9',
              },
            ],
          },
        ],
      ]),
    )
    mockGetWorkflowJobsSnapshot.mockResolvedValue({
      fetchedAt,
      data: [
        {
          id: 50,
          name: 'cached deploy',
          run_attempt: 1,
          status: 'completed',
          conclusion: 'success',
          started_at: null,
          completed_at: null,
          html_url: 'https://github.com/job/50',
          steps: [],
        },
      ],
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.status).toBe('complete')
    expect(result.requestsAttempted).toBe(1)
    expect(result.pullRequests[0]).toMatchObject({
      source: 'snapshot',
      fetchedAt: fetchedAt.toISOString(),
      pullRequest: { title: 'Cached PR' },
      reviews: [{ reviewer: 'CachedReviewer' }],
    })
    expect(result.workflowRuns[0]).toMatchObject({
      source: 'snapshot',
      fetchedAt: fetchedAt.toISOString(),
      jobs: [{ name: 'cached deploy' }],
    })
    expect(mockGetWorkflowRun).toHaveBeenCalledWith({ owner: 'navikt', repo: 'glad-fjord', run_id: 12345 })
    expect(mockListJobs).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshots).not.toHaveBeenCalled()
    expect(mockSaveWorkflowJobsSnapshot).not.toHaveBeenCalled()
  })

  it('uses a cached PR snapshot and fetches only missing review data', async () => {
    const input = makeInput()
    input.deployments = [makeDeployment(10, 82)]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []
    mockGetPrRawSnapshotsByRepoId.mockResolvedValue(
      new Map([
        [
          'pr',
          {
            fetchedAt: new Date('2026-10-14T10:00:00Z'),
            data: {
              html_url: 'https://github.com/navikt/glad-fjord/pull/82',
              title: 'Cached PR 82',
              state: 'closed',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              closed_at: '2026-01-02T00:00:00Z',
              merged_at: '2026-01-02T00:00:00Z',
              merge_commit_sha: 'a'.repeat(40),
              merged_by: { login: 'reviewer' },
              head: { sha: 'b'.repeat(40) },
              base: { sha: 'c'.repeat(40), repo: { id: 67890 } },
            },
          },
        ],
      ]),
    )
    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)
    const client = mockGetGitHubClient.mock.results[0]?.value

    expect(result.pullRequests[0]).toMatchObject({
      source: 'mixed',
      pullRequest: { title: 'Cached PR 82' },
      reviews: [{ reviewer: 'RaskElv' }],
    })
    expect(result.requestsAttempted).toBe(1)
    expect(client.pulls.get).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshots).toHaveBeenCalledWith('navikt', 'glad-fjord', 82, 67890, expect.any(Object), [
      { dataType: 'reviews', data: expect.any(Array) },
    ])
  })

  it('rejects live PR metadata from a different repository before fetching reviews or saving snapshots', async () => {
    const input = makeInput()
    input.deployments = [makeDeployment(10, 82)]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []
    const client = mockGetGitHubClient()
    client.pulls.get.mockResolvedValueOnce({
      data: {
        html_url: 'https://github.com/navikt/reused-name/pull/82',
        title: 'Different repository PR',
        state: 'closed',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        head: { sha: 'b'.repeat(40) },
        base: { sha: 'c'.repeat(40), repo: { id: 99999 } },
      },
      headers: {},
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.pullRequests[0]).toMatchObject({
      status: 'error',
      source: null,
      error: 'Pull request 82 belongs to GitHub repository 99999, not 67890',
      pullRequest: null,
      reviews: null,
    })
    expect(client.pulls.listReviews).not.toHaveBeenCalled()
    expect(mockSavePrRawSnapshots).not.toHaveBeenCalled()
  })

  it('refreshes workflow jobs while the run is not known to be complete', async () => {
    const input = makeInput()
    input.deployments = [
      {
        ...makeDeployment(10, null),
        trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/12345',
      },
    ]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots[0].data = { status: 'in_progress' }
    mockGetWorkflowJobsSnapshot.mockResolvedValue({
      fetchedAt: new Date('2026-10-14T10:00:00Z'),
      data: [{ id: 1, name: 'old job', status: 'completed', steps: [] }],
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.workflowRuns[0]).toMatchObject({ source: 'github', status: 'available' })
    expect(result.workflowRuns[0].jobs?.[0]?.name).toBe('deploy (prod)')
    expect(mockListJobs).toHaveBeenCalledTimes(1)
  })

  it('refreshes completed workflow jobs when the cached snapshot is older than five minutes', async () => {
    const input = makeInput()
    input.deployments = [
      {
        ...makeDeployment(10, null),
        trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/12345',
      },
    ]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots[0].data = { status: 'completed' }
    mockGetWorkflowJobsSnapshot.mockResolvedValue({
      fetchedAt: new Date(Date.now() - 6 * 60 * 1000),
      data: [{ id: 1, name: 'old job', status: 'completed', steps: [] }],
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.workflowRuns[0]).toMatchObject({ source: 'github', status: 'available' })
    expect(result.workflowRuns[0].jobs?.[0]?.name).toBe('deploy (prod)')
    expect(mockListJobs).toHaveBeenCalledTimes(1)
  })

  it('refreshes a recent all-attempt snapshot when the current workflow run is active', async () => {
    const input = makeInput()
    input.deployments = [
      {
        ...makeDeployment(10, null),
        trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/12345',
      },
    ]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots[0].data = { status: 'completed' }
    mockGetWorkflowJobsSnapshot.mockResolvedValue({
      fetchedAt: new Date(),
      data: [{ id: 1, name: 'old job', run_attempt: 1, status: 'completed', steps: [] }],
    })
    mockGetWorkflowRun.mockResolvedValue({
      data: { status: 'in_progress', run_attempt: 2, repository: { id: 67890 } },
      headers: {},
    })
    mockListJobs.mockResolvedValue({
      data: {
        total_count: 1,
        jobs: [{ id: 2, name: 'new attempt job', run_attempt: 2, status: 'in_progress', steps: [] }],
      },
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.workflowRuns[0]).toMatchObject({
      source: 'github',
      status: 'available',
      jobs: [{ id: 2, name: 'new attempt job', runAttempt: 2 }],
    })
    expect(result.requestsAttempted).toBe(2)
    expect(mockListJobs).toHaveBeenCalledTimes(1)
  })

  it('refreshes a completed run snapshot when GitHub reports a newer attempt', async () => {
    const input = makeInput()
    input.deployments = [
      {
        ...makeDeployment(10, null),
        trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/12345',
      },
    ]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots[0].data = { status: 'completed' }
    mockGetWorkflowJobsSnapshot.mockResolvedValue({
      fetchedAt: new Date(),
      data: [{ id: 1, name: 'old attempt job', run_attempt: 1, status: 'completed', steps: [] }],
    })
    mockGetWorkflowRun.mockResolvedValue({
      data: { status: 'completed', run_attempt: 2, repository: { id: 67890 } },
      headers: {},
    })
    mockListJobs.mockResolvedValue({
      data: {
        total_count: 1,
        jobs: [{ id: 2, name: 'latest attempt job', run_attempt: 2, status: 'completed', steps: [] }],
      },
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.workflowRuns[0]).toMatchObject({
      source: 'github',
      status: 'available',
      jobs: [{ id: 2, name: 'latest attempt job', runAttempt: 2 }],
    })
    expect(result.requestsAttempted).toBe(2)
    expect(mockListJobs).toHaveBeenCalledTimes(1)
  })

  it('records a missing PR as unavailable instead of treating it as an empty review history', async () => {
    const client = mockGetGitHubClient()
    client.pulls.get.mockRejectedValue({ status: 404 })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(makeInput())

    expect(result.status).toBe('partial')
    expect(result.pullRequests[0]).toMatchObject({
      number: 100,
      status: 'not_found',
      error: null,
      pullRequest: null,
      reviews: null,
    })
    expect(mockListReviews).not.toHaveBeenCalled()
  })

  it.each([
    ['rate limit', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }, 'rate_limit'],
    ['404', { status: 404 }, 'not_found'],
    ['server error', { status: 500, message: 'Internal Server Error' }, 'error'],
  ])(
    'marks PR evidence partial when review retrieval stops before its first page due to %s',
    async (_, failure, stoppedBy) => {
      const input = makeInput()
      input.deployments = [makeDeployment(10, 82)]
      input.verificationRuns = []
      input.prSnapshots = []
      input.workflowRunSnapshots = []
      if (stoppedBy === 'rate_limit') mockGetRateLimitError.mockReturnValueOnce(new Error('rate limit'))
      mockListReviews.mockRejectedValue(failure)

      const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

      expect(result.pullRequests[0]).toMatchObject({
        status: 'partial',
        stoppedBy,
        pullRequest: { title: 'PR 82' },
        reviews: [],
        fetchedAt: expect.any(String),
      })
      expect(result.status).toBe(stoppedBy === 'rate_limit' ? 'rate_limited' : 'partial')
    },
  )

  it('marks PR evidence partial when the request budget prevents review retrieval after metadata succeeds', async () => {
    const input = makeInput()
    input.deployments = [makeDeployment(1, 1), makeDeployment(2, 2)]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []
    mockListReviews.mockImplementation(async ({ page, pull_number }: { page: number; pull_number: number }) => ({
      data:
        pull_number === 1 && page < 98
          ? Array.from({ length: 100 }, (_, index) => ({
              id: (page - 1) * 100 + index + 1,
              user: { login: `reviewer-${index}` },
              state: 'COMMENTED',
              submitted_at: '2026-01-01T00:00:00Z',
              commit_id: 'b'.repeat(40),
              html_url: `https://github.com/review/${index + 1}`,
            }))
          : [],
    }))
    const client = mockGetGitHubClient()
    client.pulls.get.mockImplementation(async ({ pull_number }: { pull_number: number }) => ({
      data: {
        html_url: `https://github.com/navikt/glad-fjord/pull/${pull_number}`,
        title: `PR ${pull_number}`,
        state: 'closed',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        closed_at: '2026-01-02T00:00:00Z',
        merged_at: '2026-01-02T00:00:00Z',
        merge_commit_sha: 'a'.repeat(40),
        merged_by: { login: 'reviewer' },
        head: { sha: 'b'.repeat(40) },
        base: { sha: 'c'.repeat(40), repo: { id: 67890 } },
      },
    }))

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.requestsAttempted).toBe(100)
    expect(result.pullRequests[1]).toMatchObject({
      number: 2,
      status: 'partial',
      stoppedBy: 'request_limit',
      pullRequest: { title: 'PR 2' },
      reviews: [],
    })
  })

  it('records evidence skipped at the rate-limit safety threshold', async () => {
    mockGetRateLimitRemaining.mockReturnValue(100)

    const result = await fetchRepositoryDiagnosticGitHubEvidence(makeInput())

    expect(result.status).toBe('rate_limited')
    expect(result.pullRequests.every((pr) => pr.status === 'skipped_rate_limit')).toBe(true)
    expect(result.workflowRuns[0].status).toBe('skipped_rate_limit')
    expect(mockGetGitHubClient).not.toHaveBeenCalled()
  })

  it('loads workflow jobs directly from a valid deployment trigger URL when no run snapshot exists', async () => {
    const input = makeInput()
    input.deployments = [
      {
        ...makeDeployment(10, null),
        trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/54321',
      },
    ]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.status).toBe('complete')
    expect(result.workflowRuns).toMatchObject([
      { runId: '54321', attemptNumber: null, snapshotIds: [], deploymentIds: [10], status: 'available' },
    ])
    expect(mockListJobs).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'navikt', repo: 'glad-fjord', run_id: 54321, filter: 'all' }),
    )
    expect(mockListJobsForAttempt).not.toHaveBeenCalled()
  })

  it('fetches only the referenced workflow attempt and preserves deployments pointing to that attempt', async () => {
    const input = makeInput()
    input.deployments = [
      {
        ...makeDeployment(10, null),
        trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/54321/attempts/2',
      },
      {
        ...makeDeployment(11, null),
        trigger_url: 'https://github.com/navikt/glad-fjord/actions/runs/54321/attempts/2?check_suite_focus=true',
      },
    ]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.workflowRuns).toMatchObject([
      { runId: '54321', attemptNumber: 2, snapshotIds: [], deploymentIds: [10, 11], status: 'available' },
    ])
    expect(mockListJobsForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'navikt',
        repo: 'glad-fjord',
        run_id: 54321,
        attempt_number: 2,
        page: 1,
        per_page: 100,
      }),
    )
    expect(mockListJobs).not.toHaveBeenCalled()
  })

  it('keeps workflow attempts separate when deployments point to different reruns', async () => {
    const input = makeInput()
    input.deployments = [1, 2].map((attempt) => ({
      ...makeDeployment(9 + attempt, null),
      trigger_url: `https://github.com/navikt/glad-fjord/actions/runs/54321/attempts/${attempt}`,
    }))
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.workflowRuns.map((run) => [run.runId, run.attemptNumber, run.deploymentIds])).toEqual([
      ['54321', 1, [10]],
      ['54321', 2, [11]],
    ])
    expect(mockListJobsForAttempt).toHaveBeenCalledTimes(2)
    expect(mockListJobsForAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ run_id: 54321, attempt_number: 1 }),
    )
    expect(mockListJobsForAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ run_id: 54321, attempt_number: 2 }),
    )
  })

  it('includes positive branch-mismatch PR numbers as verification references', async () => {
    const input = makeInput()
    input.deployments = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []
    input.verificationRuns[0].result = {
      branchMismatch: { prNumbers: [83, 0, -1, 82, '84'] },
    }

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.pullRequests.map((pr) => pr.number)).toEqual([83, 82])
    expect(result.pullRequests[0].references).toContainEqual({
      type: 'verification_branch_mismatch',
      deploymentId: 10,
    })
    expect(result.pullRequests[1].references).toContainEqual({
      type: 'verification_branch_mismatch',
      deploymentId: 10,
    })
  })

  it('accepts workflow URLs using historical repository aliases but fetches via current repository name', async () => {
    const input = makeInput()
    input.repositoryAliases = [{ owner: 'old-navikt', repo: 'old-glad-fjord' }]
    input.deployments = [
      {
        ...makeDeployment(10, null),
        trigger_url: 'https://github.com/old-navikt/old-glad-fjord/actions/runs/54321/attempts/2',
      },
    ]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.workflowRuns).toMatchObject([
      {
        runId: '54321',
        owner: 'navikt',
        repo: 'glad-fjord',
        attemptNumber: 2,
        deploymentIds: [10],
        status: 'available',
      },
    ])
    expect(mockListJobsForAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'navikt', repo: 'glad-fjord', run_id: 54321, attempt_number: 2 }),
    )
    expect(mockSaveWorkflowJobsSnapshot).toHaveBeenCalledWith(
      'navikt',
      'glad-fjord',
      '67890',
      54321,
      2,
      expect.any(Array),
      expect.any(Object),
    )
  })

  it('collects every review page and counts each API page against the request budget', async () => {
    mockListReviews.mockImplementation(async ({ page, pull_number }: { page: number; pull_number: number }) => ({
      data:
        pull_number === 82 && page === 1
          ? Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              user: { login: `reviewer-${index}` },
              state: 'COMMENTED',
              submitted_at: '2026-01-01T00:00:00Z',
              commit_id: 'b'.repeat(40),
              html_url: `https://github.com/review/${index + 1}`,
            }))
          : pull_number === 82 && page === 2
            ? [
                {
                  id: 101,
                  user: { login: 'RaskElv' },
                  state: 'APPROVED',
                  submitted_at: '2026-01-02T00:00:00Z',
                  commit_id: 'b'.repeat(40),
                  html_url: 'https://github.com/review/101',
                },
              ]
            : [],
    }))

    const result = await fetchRepositoryDiagnosticGitHubEvidence(makeInput())

    expect(result.status).toBe('complete')
    expect(result.requestsAttempted).toBe(10)
    expect(result.pullRequests.find((pr) => pr.number === 82)?.reviews).toHaveLength(101)
    expect(mockListReviews).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 82, page: 2 }))
  })

  it('reports completed evidence as complete even when the remaining quota crosses the safety buffer afterward', async () => {
    const input = makeInput()
    input.deployments = []
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots[0].data = {}
    mockGetRateLimitRemaining.mockReturnValueOnce(201).mockReturnValueOnce(201).mockReturnValue(100)

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.status).toBe('complete')
    expect(result.workflowRuns[0].status).toBe('available')
  })

  it('preserves a first-page workflow 404 instead of exporting empty successful jobs', async () => {
    mockListJobs.mockRejectedValue({ status: 404 })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(makeInput())

    expect(result.status).toBe('partial')
    expect(result.workflowRuns[0]).toMatchObject({
      status: 'not_found',
      stoppedBy: 'not_found',
      jobs: null,
      error: null,
    })
  })

  it('preserves a first-page workflow server error', async () => {
    mockListJobs.mockRejectedValueOnce({ status: 500, message: 'Internal Server Error' })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(makeInput())

    expect(result.status).toBe('partial')
    expect(result.workflowRuns[0]).toMatchObject({
      status: 'error',
      stoppedBy: 'error',
      jobs: null,
      error: 'Internal Server Error',
    })
  })

  it('marks job data partial when a later workflow page fails', async () => {
    mockListJobs.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 1) {
        return {
          data: {
            total_count: 101,
            jobs: Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              name: `job-${index + 1}`,
              status: 'completed',
              conclusion: 'success',
              started_at: null,
              completed_at: null,
              html_url: null,
              steps: [],
            })),
          },
        }
      }
      throw { status: 500, message: 'Internal Server Error' }
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(makeInput())

    expect(result.status).toBe('partial')
    expect(result.workflowRuns[0]).toMatchObject({
      status: 'partial',
      source: 'github',
      stoppedBy: 'error',
      error: 'Internal Server Error',
    })
    expect(result.workflowRuns[0].jobs).toHaveLength(100)
  })

  it('marks review history partial when a later review page fails', async () => {
    const input = makeInput()
    input.deployments = [makeDeployment(10, 82)]
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []
    mockGetPrRawSnapshotsByRepoId.mockResolvedValue(
      new Map([
        [
          'pr',
          {
            fetchedAt: new Date('2026-10-14T10:00:00Z'),
            data: {
              html_url: 'https://github.com/navikt/glad-fjord/pull/82',
              title: 'Cached PR 82',
              state: 'closed',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              closed_at: '2026-01-02T00:00:00Z',
              merged_at: '2026-01-02T00:00:00Z',
              merge_commit_sha: 'a'.repeat(40),
              merged_by: { login: 'reviewer' },
              head: { sha: 'b'.repeat(40) },
              base: { sha: 'c'.repeat(40), repo: { id: 67890 } },
            },
          },
        ],
      ]),
    )
    mockListReviews.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 1) {
        return {
          data: Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            user: { login: `reviewer-${index}` },
            state: 'COMMENTED',
            submitted_at: '2026-01-01T00:00:00Z',
            commit_id: 'b'.repeat(40),
            html_url: `https://github.com/review/${index + 1}`,
          })),
        }
      }
      throw { status: 500, message: 'Internal Server Error' }
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.status).toBe('partial')
    expect(result.pullRequests[0]).toMatchObject({
      number: 82,
      status: 'partial',
      source: 'mixed',
      stoppedBy: 'error',
      error: 'Internal Server Error',
    })
    expect(result.pullRequests[0].reviews).toHaveLength(100)
    expect(result.pullRequests[0].fetchedAt).not.toBe('2026-10-14T10:00:00.000Z')
  })

  it('marks request-limited jobs partial only when an earlier page was retrieved', async () => {
    const input = makeInput()
    input.deployments = []
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = [...Array.from({ length: 99 }, (_, index) => index + 2), 1].map((runId) => ({
      id: runId,
      run_id: String(runId),
      github_repo_id: '67890',
      owner: 'navikt',
      repo: 'glad-fjord',
      api_version: '2022-11-28',
      api_deprecated_at: null,
      api_sunset_at: null,
      fetched_at: new Date('2026-10-14T10:00:00Z'),
      data: {},
    }))
    mockListJobs.mockImplementation(async ({ run_id }: { run_id: number }) => {
      return {
        data: {
          total_count: run_id === 1 ? 101 : 0,
          jobs:
            run_id === 1
              ? Array.from({ length: 100 }, (_, index) => ({
                  id: index + 1,
                  name: `job-${index + 1}`,
                  status: 'completed',
                  conclusion: 'success',
                  started_at: null,
                  completed_at: null,
                  html_url: null,
                  steps: [],
                }))
              : [],
        },
      }
    })

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.status).toBe('request_limited')
    expect(result.requestsAttempted).toBe(100)
    expect(result.workflowRuns[99]).toMatchObject({
      runId: '1',
      status: 'partial',
      stoppedBy: 'request_limit',
    })
    expect(result.workflowRuns[99].jobs).toHaveLength(100)
  })

  it('stops workflow pagination when total_count jobs have been retrieved', async () => {
    const input = makeInput()
    input.deployments = []
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = [...Array.from({ length: 99 }, (_, index) => index + 2), 1].map((runId) => ({
      id: runId,
      run_id: String(runId),
      github_repo_id: '67890',
      owner: 'navikt',
      repo: 'glad-fjord',
      api_version: '2022-11-28',
      api_deprecated_at: null,
      api_sunset_at: null,
      fetched_at: new Date('2026-10-14T10:00:00Z'),
      data: {},
    }))
    mockListJobs.mockImplementation(async ({ run_id }: { run_id: number }) => ({
      data: {
        total_count: run_id === 1 ? 100 : 0,
        jobs:
          run_id === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                id: index + 1,
                name: `job-${index + 1}`,
                status: 'completed',
                conclusion: 'success',
                started_at: null,
                completed_at: null,
                html_url: null,
                steps: [],
              }))
            : [],
      },
    }))

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.status).toBe('complete')
    expect(result.requestsAttempted).toBe(100)
    expect(result.workflowRuns[99]).toMatchObject({ runId: '1', status: 'available' })
    expect(result.workflowRuns[99].jobs).toHaveLength(100)
    expect(mockListJobs).toHaveBeenCalledTimes(100)
    expect(mockListJobs).not.toHaveBeenCalledWith(expect.objectContaining({ run_id: 1, page: 2 }))
  })

  it('stops after the per-export GitHub request limit and identifies omitted evidence', async () => {
    const input = makeInput()
    input.deployments = Array.from({ length: 51 }, (_, index) => makeDeployment(index + 1, index + 1))
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result.status).toBe('request_limited')
    expect(result.requestLimit).toBe(100)
    expect(result.requestsAttempted).toBe(100)
    expect(result.pullRequests).toHaveLength(51)
    expect(result.pullRequests.at(-1)).toMatchObject({
      number: 51,
      status: 'skipped_request_limit',
      fetchedAt: null,
    })
    expect(mockListReviews).toHaveBeenCalledTimes(50)
  })

  it('returns not_needed when the bounded export has no GitHub references', async () => {
    const input = makeInput()
    input.deployments = []
    input.verificationRuns = []
    input.prSnapshots = []
    input.workflowRunSnapshots = []

    const result = await fetchRepositoryDiagnosticGitHubEvidence(input)

    expect(result).toMatchObject({
      status: 'not_needed',
      pullRequests: [],
      workflowRuns: [],
    })
    expect(mockGetGitHubClient).not.toHaveBeenCalled()
  })
})
