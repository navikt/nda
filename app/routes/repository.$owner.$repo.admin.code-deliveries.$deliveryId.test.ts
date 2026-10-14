import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser,
  mockResolveRepositoryFromParams,
  mockResolveRepositoryAdminAccess,
  mockGetEvidence,
  mockGetGithubUserLookups,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockResolveRepositoryFromParams: vi.fn(),
  mockResolveRepositoryAdminAccess: vi.fn(),
  mockGetEvidence: vi.fn(),
  mockGetGithubUserLookups: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({ requireUser: mockRequireUser }))
vi.mock('~/lib/repository-resolution.server', () => ({ resolveRepositoryFromParams: mockResolveRepositoryFromParams }))
vi.mock('~/lib/authorization.server', () => ({ resolveRepositoryAdminAccess: mockResolveRepositoryAdminAccess }))
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
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990010', name: 'Rask Elv' })
    mockResolveRepositoryFromParams.mockResolvedValue(repository)
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: true, affectedApps: [] })
    mockGetEvidence.mockResolvedValue(evidence)
    mockGetGithubUserLookups.mockResolvedValue(
      new Map([['rask-elv', { display_name: 'Rask Elv', nav_ident: 'Z990010' }]]),
    )
  })

  it('requires repository admin access before loading evidence', async () => {
    mockResolveRepositoryAdminAccess.mockResolvedValue({ authorized: false, affectedApps: [] })

    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 403 })

    expect(mockGetEvidence).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', 'abc', '17extra', '9007199254740992'])('rejects invalid delivery id %s', async (deliveryId) => {
    await expect(
      loader({
        params: { ...params, deliveryId },
        request: makeRequest(),
      } as never),
    ).rejects.toMatchObject({ status: 400 })
    expect(mockRequireUser).not.toHaveBeenCalled()
  })

  it('returns evidence and mapped reviewer names for the repository delivery', async () => {
    const result = await loader({ params, request: makeRequest() } as never)

    expect(mockGetEvidence).toHaveBeenCalledWith(5, 17)
    expect(mockGetGithubUserLookups).toHaveBeenCalledWith(['rask-elv'])
    expect(result).toMatchObject({
      repository: { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' },
      delivery: evidence,
      userMappings: { 'rask-elv': { display_name: 'Rask Elv', nav_ident: 'Z990010' } },
    })
  })

  it('returns not found if the delivery does not belong to the repository', async () => {
    mockGetEvidence.mockResolvedValue(null)

    await expect(loader({ params, request: makeRequest() } as never)).rejects.toMatchObject({ status: 404 })
    expect(mockGetGithubUserLookups).not.toHaveBeenCalled()
  })
})
