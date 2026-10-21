import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getApp, getUser, getRepositoryView, applicationLoader, applicationAction } = vi.hoisted(() => ({
  getApp: vi.fn(),
  getUser: vi.fn(),
  getRepositoryView: vi.fn(),
  applicationLoader: vi.fn(),
  applicationAction: vi.fn(),
}))
vi.mock('~/db/monitored-applications.server', () => ({ getMonitoredApplicationByIdentity: getApp }))
vi.mock('~/db/deployment-repository-view.server', () => ({ getDeploymentRepositoryView: getRepositoryView }))
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
    getRepositoryView.mockResolvedValue({ deployment: { id: 42 } })
    applicationLoader.mockResolvedValue({ deployment: { id: 42, monitored_app_id: 3 } })
  })

  it('loads repository data independently of the application assessment', async () => {
    expect(await loader(args('?view=repository&period=all'))).toMatchObject({
      view: 'repository',
      repositoryView: { deployment: { id: 42 } },
    })
    expect(getRepositoryView).toHaveBeenCalledWith(42, null, 3)
    expect(applicationLoader).not.toHaveBeenCalled()
  })

  it.each(['', '?view=application', '?view=invalid'])('preserves the application view for %s', async (search) => {
    expect(await loader(args(search))).toMatchObject({ view: 'application', deployment: { id: 42 } })
    expect(applicationLoader).toHaveBeenCalledOnce()
    expect(getRepositoryView).not.toHaveBeenCalled()
  })

  it('does not show a deployment belonging to another application', async () => {
    applicationLoader.mockResolvedValue({ deployment: { id: 42, monitored_app_id: 4 } })
    await expect(loader(args())).rejects.toMatchObject({ status: 404 })
    getRepositoryView.mockResolvedValue(null)
    await expect(loader(args('?view=repository'))).rejects.toMatchObject({ status: 404 })
  })

  it.each(['abc', '0', '-1', '42x', '2147483648'])('rejects invalid deployment ID %s', async (id) => {
    await expect(loader(args('?view=repository', id))).rejects.toMatchObject({ status: 400 })
    expect(getApp).not.toHaveBeenCalled()
    expect(applicationLoader).not.toHaveBeenCalled()
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
