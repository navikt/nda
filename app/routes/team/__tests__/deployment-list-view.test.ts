import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getApp, getMonorepo, getUser, getData } = vi.hoisted(() => ({
  getApp: vi.fn(),
  getMonorepo: vi.fn(),
  getUser: vi.fn(),
  getData: vi.fn(),
}))
vi.mock('~/db/monitored-applications.server', () => ({ getMonitoredApplicationByIdentity: getApp }))
vi.mock('~/db/monorepo.server', () => ({ getMonorepoSiblings: getMonorepo }))
vi.mock('~/lib/auth.server', () => ({ getUserIdentity: getUser }))
vi.mock('~/lib/deployments/multi-app-deployments.server', () => ({ getMultiAppDeploymentsPageData: getData }))

import { loader } from '../$team.env.$env.app.$app.deployments'

function args(search = '') {
  const url = new URL(`http://localhost/team/team-fjord/env/prod-gcp/app/glad-fjord/deployments${search}`)
  return {
    params: { team: 'team-fjord', env: 'prod-gcp', app: 'glad-fjord' },
    url,
    request: new Request(url),
  } as never
}

describe('deployment list view selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getApp.mockResolvedValue({ id: 3, team_slug: 'team-fjord', app_name: 'glad-fjord' })
    getMonorepo.mockResolvedValue(null)
    getUser.mockResolvedValue(null)
    getData.mockResolvedValue({ deployments: [], total_pages: 3 })
  })

  it.each(['', '?view=application', '?view=invalid'])('keeps application defaults for %s', async (search) => {
    expect(await loader(args(search))).toMatchObject({ view: 'application' })
    expect(getData).toHaveBeenCalledWith(
      [{ id: 3, team_slug: 'team-fjord' }],
      expect.objectContaining({
        view: 'application',
        page: 1,
      }),
      null,
    )
  })

  it('forwards independent filters and keeps app scope in repository mode', async () => {
    const result = await loader(
      args('?view=repository&status=error&repositoryStatus=incomplete&period=all&page=2&sha=abc&deployer=glad-fjord'),
    )
    expect(result).toMatchObject({ view: 'repository' })
    expect(getData).toHaveBeenCalledWith(
      [{ id: 3, team_slug: 'team-fjord' }],
      expect.objectContaining({
        view: 'repository',
        status: 'error',
        repositoryStatus: 'incomplete',
        page: 2,
        sha: 'abc',
        deployer: 'glad-fjord',
      }),
      null,
    )
  })

  it('keeps model, coverage and other filters when redirecting beyond the last page', async () => {
    const response = await loader(args('?view=repository&repositoryStatus=missing_link&page=5&period=all')).catch(
      (error) => error,
    )
    expect(response).toBeInstanceOf(Response)
    const location = new URL(response.headers.get('Location'), 'http://localhost')
    expect(Object.fromEntries(location.searchParams)).toEqual({
      view: 'repository',
      repositoryStatus: 'missing_link',
      page: '3',
      period: 'all',
    })
  })

  it.each(['NaN', '0', '-1', '1x', '9007199254740992'])('rejects invalid page %s', async (page) => {
    await expect(loader(args(`?view=repository&page=${page}`))).rejects.toMatchObject({ status: 400 })
    expect(getData).not.toHaveBeenCalled()
  })
})
