import { describe, expect, it } from 'vitest'
import { deploymentListUrl, deploymentViewUrl } from '../deployment-view'

describe('deployment list context', () => {
  it.each(['application', 'repository'] as const)(
    'keeps the original %s list when switching detail views',
    (listView) => {
      const original = new URLSearchParams({
        view: listView,
        listView,
        status: 'error',
        repositoryStatus: 'incomplete',
        page: '2',
        period: 'all',
      })
      const repository = new URL(deploymentViewUrl('/deployments/42', original, 'repository'), 'http://localhost')
      const application = new URL(
        deploymentViewUrl('/deployments/42', repository.searchParams, 'application'),
        'http://localhost',
      )
      const back = new URL(deploymentListUrl('/deployments', application.searchParams), 'http://localhost')
      expect(Object.fromEntries(back.searchParams)).toEqual({
        view: listView,
        status: 'error',
        repositoryStatus: 'incomplete',
        page: '2',
        period: 'all',
      })
      expect(original.get('listView')).toBe(listView)
      expect(original.get('view')).toBe(listView)
    },
  )

  it.each([null, 'invalid'])('uses the application list for older links with listView=%s', (listView) => {
    const params = new URLSearchParams('view=repository&page=3')
    if (listView) params.set('listView', listView)
    expect(deploymentListUrl('/deployments', params)).toBe('/deployments?view=application&page=3')
  })
})
