import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockReposGet = vi.fn()
const mockChecksListAnnotations = vi.fn()

async function fakePaginate(_method: unknown, _params: unknown, mapFn: (response: unknown) => unknown[]) {
  const response = await mockChecksListAnnotations()
  return mapFn(response)
}

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    repos: {
      get: mockReposGet,
    },
    checks: {
      listAnnotations: mockChecksListAnnotations,
    },
    paginate: fakePaginate,
  }),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import { loader } from '~/routes/api/checks.annotations'

const mockPoolQuery = pool.query as Mock

function makeRequest(params: Record<string, string>): Request {
  const url = new URL('https://example.com/api/checks/annotations')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new Request(url)
}

describe('checks.annotations loader', () => {
  beforeEach(() => {
    mockReposGet.mockReset()
    mockChecksListAnnotations.mockReset()
    mockPoolQuery.mockReset()
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 1 }] })
    mockReposGet.mockResolvedValue({ data: { id: 999 } })
  })

  it('archives the raw annotations response after fetching', async () => {
    const rawAnnotations = [
      {
        path: 'src/foo.ts',
        start_line: 1,
        end_line: 2,
        annotation_level: 'warning',
        message: 'some issue',
      },
    ]
    mockChecksListAnnotations.mockResolvedValueOnce({
      data: rawAnnotations,
      headers: { 'x-github-api-version-selected': '2022-11-28' },
    })

    const request = makeRequest({ owner: 'navikt', repo: 'annotations-archive-repo', check_run_id: '555' })
    const response = await loader({ request, params: {}, context: {}, url: new URL(request.url) } as never)
    const body = await response.json()

    expect(body.annotations).toHaveLength(1)
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_check_annotations_raw_snapshots'), [
      999,
      'navikt',
      'annotations-archive-repo',
      555,
      '2022-11-28',
      null,
      null,
      JSON.stringify(rawAnnotations),
    ])
  })

  it('still returns annotations even if archiving fails', async () => {
    const rawAnnotations = [
      { path: 'src/foo.ts', start_line: 1, end_line: 2, annotation_level: 'notice', message: 'info' },
    ]
    mockChecksListAnnotations.mockResolvedValueOnce({ data: rawAnnotations, headers: {} })
    mockPoolQuery.mockRejectedValue(new Error('db down'))

    const request = makeRequest({ owner: 'navikt', repo: 'db-failure-repo', check_run_id: '555' })
    const response = await loader({ request, params: {}, context: {}, url: new URL(request.url) } as never)
    const body = await response.json()

    expect(body.annotations).toHaveLength(1)
  })

  it('rejects invalid check_run_id without calling GitHub', async () => {
    const request = makeRequest({ owner: 'navikt', repo: 'invalid-repo', check_run_id: '-1' })
    const response = await loader({ request, params: {}, context: {}, url: new URL(request.url) } as never)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('positive number')
    expect(mockChecksListAnnotations).not.toHaveBeenCalled()
  })
})
