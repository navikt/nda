import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchApplicationDeployments, NaisDeploymentEnumerationError } from '../nais.server'

interface DeploymentPage {
  nodes: Array<{ id: string }>
  totalCount: number
  hasNextPage: boolean
  endCursor: string | null
}

function responsePage(page: DeploymentPage | null) {
  return new Response(
    JSON.stringify({
      data: {
        team: page
          ? {
              environment: {
                application: {
                  name: 'app-a',
                  team: { slug: 'team-a' },
                  teamEnvironment: { environment: { name: 'prod-gcp' } },
                  deployments: {
                    pageInfo: {
                      totalCount: page.totalCount,
                      hasNextPage: page.hasNextPage,
                      hasPreviousPage: false,
                      pageEnd: page.nodes.length,
                      pageStart: 0,
                      startCursor: page.nodes[0]?.id ?? '',
                      endCursor: page.endCursor,
                    },
                    nodes: page.nodes.map((node) => ({
                      ...node,
                      createdAt: '2026-01-01T00:00:00Z',
                      environmentName: 'prod-gcp',
                      teamSlug: 'team-a',
                      triggerUrl: '',
                      repository: 'navikt/repo-a',
                      commitSha: 'a'.repeat(40),
                      deployerUsername: 'Z990001',
                      resources: { nodes: [] },
                    })),
                  },
                },
              },
            }
          : { environment: null },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function mockPages(pages: Array<DeploymentPage | null>) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const page = pages.shift()
    if (page === undefined) throw new Error('Unexpected Nais pagination request')
    return responsePage(page)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchApplicationDeployments completeness validation', () => {
  it('returns deployments only after validating the complete pagination', async () => {
    const fetchMock = mockPages([
      { nodes: [{ id: 'deployment-b' }], totalCount: 2, hasNextPage: true, endCursor: 'cursor-a' },
      { nodes: [{ id: 'deployment-a' }], totalCount: 2, hasNextPage: false, endCursor: 'cursor-b' },
    ])

    const deployments = await fetchApplicationDeployments('team-a', 'prod-gcp', 'app-a', 1)

    expect(deployments.map((deployment) => deployment.id)).toEqual(['deployment-b', 'deployment-a'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects duplicate deployment IDs across pages', async () => {
    mockPages([
      { nodes: [{ id: 'deployment-a' }], totalCount: 2, hasNextPage: true, endCursor: 'cursor-a' },
      { nodes: [{ id: 'deployment-a' }], totalCount: 2, hasNextPage: false, endCursor: 'cursor-b' },
    ])

    await expect(fetchApplicationDeployments('team-a', 'prod-gcp', 'app-a', 1)).rejects.toMatchObject({
      name: 'NaisDeploymentEnumerationError',
      validation: { reason: 'duplicate_deployment_id', pageIndex: 1 },
    })
  })

  it('rejects an ID count that does not match totalCount', async () => {
    mockPages([{ nodes: [{ id: 'deployment-a' }], totalCount: 2, hasNextPage: false, endCursor: 'cursor-a' }])

    await expect(fetchApplicationDeployments('team-a', 'prod-gcp', 'app-a', 1)).rejects.toMatchObject({
      name: 'NaisDeploymentEnumerationError',
      validation: { reason: 'id_count_mismatch' },
    })
  })

  it('rejects changing totalCount between pages', async () => {
    mockPages([
      { nodes: [{ id: 'deployment-a' }], totalCount: 2, hasNextPage: true, endCursor: 'cursor-a' },
      { nodes: [{ id: 'deployment-b' }], totalCount: 3, hasNextPage: false, endCursor: 'cursor-b' },
    ])

    await expect(fetchApplicationDeployments('team-a', 'prod-gcp', 'app-a', 1)).rejects.toMatchObject({
      name: 'NaisDeploymentEnumerationError',
      validation: { reason: 'inconsistent_total_count', pageIndex: 1 },
    })
  })

  it('rejects a missing application instead of returning a partial list', async () => {
    mockPages([null])

    await expect(fetchApplicationDeployments('team-a', 'prod-gcp', 'app-a', 1)).rejects.toBeInstanceOf(
      NaisDeploymentEnumerationError,
    )
  })

  it('rejects a repeated cursor before requesting another page', async () => {
    const fetchMock = mockPages([
      { nodes: [{ id: 'deployment-a' }], totalCount: 3, hasNextPage: true, endCursor: 'cursor-a' },
      { nodes: [{ id: 'deployment-b' }], totalCount: 3, hasNextPage: true, endCursor: 'cursor-a' },
    ])

    await expect(fetchApplicationDeployments('team-a', 'prod-gcp', 'app-a', 1)).rejects.toMatchObject({
      name: 'NaisDeploymentEnumerationError',
      validation: { reason: 'duplicate_cursor', pageIndex: 1 },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a next-page response without an end cursor', async () => {
    mockPages([{ nodes: [{ id: 'deployment-a' }], totalCount: 2, hasNextPage: true, endCursor: null }])

    await expect(fetchApplicationDeployments('team-a', 'prod-gcp', 'app-a', 1)).rejects.toMatchObject({
      name: 'NaisDeploymentEnumerationError',
      validation: { reason: 'missing_cursor', pageIndex: 0 },
    })
  })
})
