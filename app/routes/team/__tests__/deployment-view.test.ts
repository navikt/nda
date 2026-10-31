import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getApp,
  getUser,
  getRepositoryView,
  getDeploymentById,
  getPreviousDeploymentForDiff,
  getCompareSnapshot,
  getPrDataForDiff,
  getUsersByIdentifiers,
  applicationLoader,
  applicationAction,
} = vi.hoisted(() => ({
  getApp: vi.fn(),
  getUser: vi.fn(),
  getRepositoryView: vi.fn(),
  getDeploymentById: vi.fn(),
  getPreviousDeploymentForDiff: vi.fn(),
  getCompareSnapshot: vi.fn(),
  getPrDataForDiff: vi.fn(),
  getUsersByIdentifiers: vi.fn(),
  applicationLoader: vi.fn(),
  applicationAction: vi.fn(),
}))
vi.mock('~/db/monitored-applications.server', () => ({ getMonitoredApplicationByIdentity: getApp }))
vi.mock('~/db/deployment-repository-view.server', () => ({ getDeploymentRepositoryView: getRepositoryView }))
vi.mock('~/db/deployments.server', () => ({ getDeploymentById, getPreviousDeploymentForDiff }))
vi.mock('~/db/user-github-lookups.server', () => ({ getUsersByIdentifiers }))
vi.mock('~/db/verification-diff.server', () => ({ getCompareSnapshotForCommit: getCompareSnapshot }))
vi.mock('~/lib/verification', () => ({ getPrDataForDiff }))
vi.mock('~/lib/auth.server', () => ({ getUserIdentity: getUser }))
vi.mock('../../deployments/$id', () => ({ loader: applicationLoader, action: applicationAction }))

import { action, loader } from '../$team.env.$env.app.$app.deployments.$deploymentId'

function args(search = '', deploymentId = '42') {
  const url = new URL(
    `http://localhost/team/team-fjord/env/prod-gcp/app/glad-fjord/deployments/${deploymentId}${search}`,
  )
  return {
    params: { team: 'team-fjord', env: 'prod-gcp', app: 'glad-fjord', deploymentId },
    url,
    request: new Request(url),
  } as never
}

describe('deployment view dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApp.mockResolvedValue({ id: 3, app_name: 'glad-fjord' })
    getUser.mockResolvedValue(null)
    getUsersByIdentifiers.mockResolvedValue(new Map())
    getPrDataForDiff.mockResolvedValue(null)
    getPreviousDeploymentForDiff.mockResolvedValue(null)
    getRepositoryView.mockResolvedValue({
      deployment: { id: 42 },
      application: { range: null },
      userMappings: {},
    })
    getDeploymentById.mockResolvedValue({
      id: 42,
      monitored_app_id: 3,
      commit_sha: 'a'.repeat(40),
      detected_github_owner: null,
      detected_github_repo_name: null,
      github_pr_number: null,
      github_pr_data: null,
      resources: [{ kind: 'Deployment', name: 'glad-fjord' }],
      workflow_trigger_config: { workflowPath: '.github/workflows/deploy.yml', triggerEvent: 'push' },
    })
    applicationLoader.mockResolvedValue({ deployment: { id: 42, monitored_app_id: 3 } })
  })

  it('loads only the shared repository detail fields without invoking the application loader', async () => {
    const result = await loader(args('?view=repository&period=all'))
    expect(result).toMatchObject({
      view: 'repository',
      repositoryView: { deployment: { id: 42 } },
      deploymentDetails: { deployment: { commit_sha: 'a'.repeat(40) } },
    })
    expect(result).not.toHaveProperty('deploymentDetails.deployment.id')
    expect(result).not.toHaveProperty('deploymentDetails.deployment.monitored_app_id')
    expect(result).not.toHaveProperty('deploymentDetails.deployment.resources')
    expect(result).not.toHaveProperty('deploymentDetails.deployment.workflow_trigger_config')
    expect(getRepositoryView).toHaveBeenCalledWith(42, null, 3)
    expect(getDeploymentById).toHaveBeenCalledWith(42)
    expect(getPrDataForDiff).not.toHaveBeenCalled()
    expect(applicationLoader).not.toHaveBeenCalled()
  })

  it('uses the current repository identity for stored interval commits after a repository rename', async () => {
    getRepositoryView.mockResolvedValue({
      deployment: { id: 42 },
      application: { range: { baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40) } },
      repository: { githubOwner: 'navikt', githubRepoName: 'current-name' },
      userMappings: { deployer: { display_name: 'Glad Fjord' } },
    })
    getDeploymentById.mockResolvedValue({
      id: 42,
      monitored_app_id: 3,
      commit_sha: 'a'.repeat(40),
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'old-name',
      deployer_username: 'Z990001',
      github_pr_number: 42,
      github_pr_data: {
        creator: { username: 'pr-creator' },
        merger: { username: 'pr-merger' },
        assignees: [{ username: 'assignee' }],
        reviewers: [{ username: 'reviewer' }],
        requested_reviewers: [{ username: 'requested-reviewer' }],
        commits: [{ author: { username: 'pr-commit-author' } }],
        comments: [{ user: { username: 'comment-author' } }],
      },
      workflow_trigger_config: null,
    })
    getCompareSnapshot.mockImplementation(async (_owner, _repo, _sha, expectedBaseSha) => ({
      base_sha: expectedBaseSha ?? 'd'.repeat(40),
      data: {
        commits: [
          {
            sha: 'a'.repeat(40),
            message: 'feat: Add feature',
            authorUsername: 'interval-author',
            htmlUrl: 'https://github.com/navikt/current-name/commit/aaaaaaaa',
          },
        ],
      },
    }))
    getPreviousDeploymentForDiff.mockResolvedValue({ commit_sha: 'd'.repeat(40) })
    getUsersByIdentifiers.mockResolvedValue(
      new Map([
        ['pr-creator', { display_name: 'Rask Elv', nav_ident: 'Z990002' }],
        ['Z990001', { display_name: 'Glad Fjord', nav_ident: 'Z990001' }],
      ]),
    )

    const result = await loader(args('?view=repository'))
    if (result instanceof Response || result.view !== 'repository') {
      throw new Error('Expected repository deployment details')
    }
    expect(getUsersByIdentifiers).toHaveBeenCalledWith(
      expect.arrayContaining([
        'pr-creator',
        'pr-merger',
        'assignee',
        'reviewer',
        'requested-reviewer',
        'pr-commit-author',
        'comment-author',
        'interval-author',
        'Z990001',
      ]),
    )
    expect(result.deploymentDetails.userMappings).toMatchObject({
      deployer: { display_name: 'Glad Fjord' },
      'pr-creator': { display_name: 'Rask Elv' },
      Z990001: { display_name: 'Glad Fjord' },
    })
    expect(result.deploymentDetails.previousDeploymentForDiff).toEqual({ commit_sha: 'b'.repeat(40) })
    expect(result.deploymentDetails.deliveryCommits).toHaveLength(1)
    expect(result.deploymentDetails.deployment).toMatchObject({
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'current-name',
    })
    expect(getCompareSnapshot).toHaveBeenCalledTimes(2)
    expect(getCompareSnapshot).toHaveBeenCalledWith('navikt', 'old-name', 'a'.repeat(40))
    expect(getCompareSnapshot).toHaveBeenCalledWith('navikt', 'current-name', 'a'.repeat(40), 'b'.repeat(40))
  })

  it.each([true, false])(
    'looks for the exact stored interval under the detected name after a rename when the current name misses (snapshot exists: %s)',
    async (snapshotExists) => {
      getRepositoryView.mockResolvedValue({
        deployment: { id: 42 },
        application: { range: { baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40) } },
        repository: { githubOwner: 'navikt', githubRepoName: 'current-name' },
        userMappings: {},
      })
      getDeploymentById.mockResolvedValue({
        id: 42,
        monitored_app_id: 3,
        commit_sha: 'a'.repeat(40),
        title: 'feat: Repository delivery',
        detected_github_owner: 'navikt',
        detected_github_repo_name: 'old-name',
        github_pr_number: null,
        github_pr_data: null,
        workflow_trigger_config: null,
      })
      getCompareSnapshot.mockImplementation(async (_owner, repo, _sha, expectedBaseSha) =>
        snapshotExists && repo === 'old-name' && expectedBaseSha === 'b'.repeat(40)
          ? {
              base_sha: expectedBaseSha,
              data: {
                commits: [
                  {
                    sha: 'a'.repeat(40),
                    message: 'feat: Repository delivery',
                    authorUsername: 'rask-elv',
                    htmlUrl: 'https://github.com/navikt/old-name/commit/aaaaaaaa',
                  },
                ],
              },
            }
          : null,
      )

      const result = await loader(args('?view=repository'))
      if (result instanceof Response || result.view !== 'repository') {
        throw new Error('Expected repository deployment details')
      }
      expect(getCompareSnapshot.mock.calls).toEqual([
        ['navikt', 'current-name', 'a'.repeat(40), 'b'.repeat(40)],
        ['navikt', 'old-name', 'a'.repeat(40), 'b'.repeat(40)],
      ])
      expect(result.deploymentDetails.displayTitle).toBe('feat: Repository delivery')
      if (snapshotExists) {
        expect(result.deploymentDetails.deliveryCommits).toHaveLength(1)
      } else {
        expect(result.deploymentDetails.deliveryCommits).toBeNull()
      }
    },
  )

  it('uses the application previous-deployment interval for the shared deployment title', async () => {
    getRepositoryView.mockResolvedValue({
      deployment: { id: 42 },
      application: { range: { baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40) } },
      userMappings: {},
    })
    getDeploymentById.mockResolvedValue({
      id: 42,
      monitored_app_id: 3,
      commit_sha: 'a'.repeat(40),
      title: 'feat: Repository delivery',
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'glad-fjord',
      github_pr_number: 42,
      github_pr_data: null,
      workflow_trigger_config: null,
    })
    getPreviousDeploymentForDiff.mockResolvedValue({ commit_sha: 'd'.repeat(40) })
    getCompareSnapshot.mockImplementation(
      async (_owner: string, _repo: string, _sha: string, expectedBaseSha?: string) => ({
        base_sha: expectedBaseSha ?? 'd'.repeat(40),
        data: {
          commits: expectedBaseSha
            ? [
                {
                  sha: 'a'.repeat(40),
                  message: 'feat: Repository delivery',
                  authorUsername: 'rask-elv',
                  htmlUrl: 'https://github.com/navikt/glad-fjord/commit/aaaaaaaa',
                },
              ]
            : [
                {
                  sha: 'e'.repeat(40),
                  message: 'chore: First change',
                  authorUsername: 'glad-fjord',
                  htmlUrl: 'https://github.com/navikt/glad-fjord/commit/eeeeeeee',
                },
                {
                  sha: 'a'.repeat(40),
                  message: 'feat: Repository delivery',
                  authorUsername: 'rask-elv',
                  htmlUrl: 'https://github.com/navikt/glad-fjord/commit/aaaaaaaa',
                },
              ],
        },
      }),
    )
    getPrDataForDiff.mockResolvedValue({
      commits: [{ sha: 'e'.repeat(40) }, { sha: 'a'.repeat(40) }],
    })

    const result = await loader(args('?view=repository'))
    if (result instanceof Response || result.view !== 'repository') {
      throw new Error('Expected repository deployment details')
    }
    expect(result.deploymentDetails.displayTitle).toBe('feat: Repository delivery')
    expect(result.deploymentDetails.deliveryCommits).toHaveLength(1)
    expect(result.deploymentDetails.previousDeploymentForDiff).toEqual({ commit_sha: 'b'.repeat(40) })
    expect(getPrDataForDiff).toHaveBeenCalledWith('navikt', 'glad-fjord', 42)
  })

  it('does not use an application interval as a comparison when its head differs from the deployment', async () => {
    getRepositoryView.mockResolvedValue({
      deployment: { id: 42 },
      application: { range: { baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40) } },
      userMappings: {},
    })
    getPreviousDeploymentForDiff.mockResolvedValue({ commit_sha: 'b'.repeat(40) })
    getCompareSnapshot.mockResolvedValue({
      base_sha: 'b'.repeat(40),
      data: {
        commits: [
          {
            sha: 'a'.repeat(40),
            message: 'feat: Add feature',
            authorUsername: 'glad-fjord',
            htmlUrl: 'https://github.com/navikt/glad-fjord/commit/aaaaaaaa',
          },
        ],
      },
    })
    getDeploymentById.mockResolvedValue({
      id: 42,
      monitored_app_id: 3,
      commit_sha: 'a'.repeat(40),
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'glad-fjord',
      github_pr_number: null,
      github_pr_data: null,
      workflow_trigger_config: null,
    })
    const result = await loader(args('?view=repository'))
    if (result instanceof Response || result.view !== 'repository') {
      throw new Error('Expected repository deployment details')
    }
    expect(result.deploymentDetails.previousDeploymentForDiff).toBeNull()
    expect(result.deploymentDetails.deliveryCommits).toBeNull()
    expect(getCompareSnapshot).toHaveBeenCalledOnce()
    expect(getCompareSnapshot).toHaveBeenCalledWith('navikt', 'glad-fjord', 'a'.repeat(40))
  })

  it.each(['', '?view=application', '?view=invalid'])('keeps the existing application path for %s', async (search) => {
    expect(await loader(args(search))).toMatchObject({ view: 'application', deployment: { id: 42 } })
    expect(applicationLoader).toHaveBeenCalledOnce()
    expect(getRepositoryView).not.toHaveBeenCalled()
    expect(getDeploymentById).not.toHaveBeenCalled()
    expect(getPreviousDeploymentForDiff).not.toHaveBeenCalled()
    expect(getCompareSnapshot).not.toHaveBeenCalled()
    expect(getUsersByIdentifiers).not.toHaveBeenCalled()
  })

  it('does not show a deployment belonging to another application', async () => {
    applicationLoader.mockResolvedValue({ deployment: { id: 42, monitored_app_id: 4 } })
    await expect(loader(args())).rejects.toMatchObject({ status: 404 })
    getDeploymentById.mockResolvedValue({ id: 42, monitored_app_id: 4 })
    await expect(loader(args('?view=repository'))).rejects.toMatchObject({ status: 404 })
    getDeploymentById.mockResolvedValue({ id: 42, monitored_app_id: 3 })
    getRepositoryView.mockResolvedValue(null)
    await expect(loader(args('?view=repository'))).rejects.toMatchObject({ status: 404 })
  })

  it('returns 404 when the deployment detail lookup does not find the deployment', async () => {
    getDeploymentById.mockResolvedValue(null)
    await expect(loader(args('?view=repository'))).rejects.toMatchObject({ status: 404 })
    expect(getRepositoryView).toHaveBeenCalledWith(42, null, 3)
  })

  it.each(['abc', '0', '-1', '42x', '2147483648'])('rejects invalid deployment ID %s', async (id) => {
    await expect(loader(args('?view=repository', id))).rejects.toMatchObject({ status: 400 })
    expect(getApp).not.toHaveBeenCalled()
    expect(applicationLoader).not.toHaveBeenCalled()
    expect(getDeploymentById).not.toHaveBeenCalled()
    expect(getRepositoryView).not.toHaveBeenCalled()
  })

  it('keeps actions delegated to the shared handler, including its read-only guard', async () => {
    const input = args('?view=repository')
    await action(input)
    expect(applicationAction).toHaveBeenCalledWith({
      params: { id: '42' },
      request: expect.any(Request),
      url: expect.any(URL),
    })
  })
})
