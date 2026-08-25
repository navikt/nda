import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockListForRef = vi.fn()
const mockListAnnotations = vi.fn()
const mockPaginate = vi.fn()

vi.mock('~/lib/github/client.server', () => ({
  getGitHubClient: () => ({
    checks: {
      listForRef: mockListForRef,
      listAnnotations: mockListAnnotations,
    },
    paginate: mockPaginate,
  }),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { getChecksForCommit } from '~/lib/github/pr/checks.server'

describe('getChecksForCommit', () => {
  beforeEach(() => {
    mockListForRef.mockReset()
    mockListAnnotations.mockReset()
    mockPaginate.mockReset()
  })

  it('returns a definitive empty result when there are no check runs for the commit', async () => {
    mockPaginate.mockResolvedValueOnce([])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result).toEqual(
      expect.objectContaining({ checks: [], checks_passed: null, isDefinitive: true, matchedSha: 'commitsha1' }),
    )
    expect(mockPaginate).toHaveBeenCalledWith(
      mockListForRef,
      {
        owner: 'navikt',
        repo: 'nda',
        ref: 'commitsha1',
        per_page: 100,
      },
      expect.any(Function),
    )
  })

  it('retries against the fallback SHA when the primary ref has zero check runs', async () => {
    mockPaginate.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'headsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'mergecommitsha1', 'headsha1')

    expect(result?.matchedSha).toBe('headsha1')
    expect(result?.checks).toHaveLength(1)
    expect(mockPaginate).toHaveBeenNthCalledWith(
      1,
      mockListForRef,
      { owner: 'navikt', repo: 'nda', ref: 'mergecommitsha1', per_page: 100 },
      expect.any(Function),
    )
    expect(mockPaginate).toHaveBeenNthCalledWith(
      2,
      mockListForRef,
      { owner: 'navikt', repo: 'nda', ref: 'headsha1', per_page: 100 },
      expect.any(Function),
    )
  })

  it('returns a definitive empty result when both the primary and fallback SHA have zero check runs', async () => {
    mockPaginate.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const result = await getChecksForCommit('navikt', 'nda', 'mergecommitsha1', 'headsha1')

    expect(result).toEqual(
      expect.objectContaining({ checks: [], checks_passed: null, isDefinitive: true, matchedSha: 'mergecommitsha1' }),
    )
    expect(mockPaginate).toHaveBeenCalledTimes(2)
  })

  it('returns checks_passed=true when all check runs succeeded or were skipped', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: { name: 'GitHub Actions', slug: 'github-actions' },
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
      {
        id: 2,
        name: 'lint',
        status: 'completed',
        conclusion: 'skipped',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: { name: 'GitHub Actions', slug: 'github-actions' },
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.checks_passed).toBe(true)
    expect(result?.checks).toHaveLength(2)
    expect(result?.checks[0].name).toBe('build')
    expect(result?.rawSnapshot.schemaVersion).toBe(1)
    expect(result?.rawSnapshot.checkRuns).toHaveLength(2)
    expect(result?.rawSnapshot.checkRuns[0].id).toBe(1)
  })

  it('returns checks_passed=false when a check run failed', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 3,
        name: 'test',
        status: 'completed',
        conclusion: 'failure',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 11 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.checks_passed).toBe(false)
  })

  it('returns checks_passed=null (not false) when a check run is still in progress', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 6,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
      {
        id: 7,
        name: 'test',
        status: 'in_progress',
        conclusion: null,
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.checks_passed).toBeNull()
  })

  it('returns checks_passed=null (not false) when a check run is still queued', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 8,
        name: 'test',
        status: 'queued',
        conclusion: null,
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.checks_passed).toBeNull()
  })

  it('fetches all pages of check runs via client.paginate', async () => {
    const manyChecks = Array.from({ length: 150 }, (_, i) => ({
      id: i + 1,
      name: `check-${i + 1}`,
      status: 'completed',
      conclusion: 'success',
      started_at: null,
      completed_at: null,
      html_url: null,
      head_sha: 'commitsha1',
      details_url: null,
      external_id: null,
      check_suite: { id: 10 },
      app: null,
      output: { title: null, summary: null, text: null, annotations_count: 0 },
    }))
    mockPaginate.mockResolvedValueOnce(manyChecks)

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.checks).toHaveLength(150)
  })

  it('propagates errors instead of swallowing them, to avoid overwriting cached data', async () => {
    mockPaginate.mockRejectedValueOnce(new Error('GitHub API unavailable'))

    await expect(getChecksForCommit('navikt', 'nda', 'commitsha1')).rejects.toThrow('GitHub API unavailable')
  })

  it('captures the GitHub API version selected from the response headers', async () => {
    mockPaginate.mockImplementationOnce(async (_route, _params, mapFn) => {
      const response = {
        headers: { 'x-github-api-version-selected': '2022-11-28' },
        data: [
          {
            id: 5,
            name: 'build',
            status: 'completed',
            conclusion: 'success',
            started_at: null,
            completed_at: null,
            html_url: null,
            head_sha: 'commitsha1',
            details_url: null,
            external_id: null,
            check_suite: { id: 10 },
            app: null,
            output: { title: null, summary: null, text: null, annotations_count: 0 },
          },
        ],
      }
      return mapFn(response)
    })

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.rawSnapshot.githubApiVersion).toBe('2022-11-28')
  })

  it('logs a warning when the GitHub API version is closing down', async () => {
    const { logger } = await import('~/lib/logger.server')
    mockPaginate.mockImplementationOnce(async (_route, _params, mapFn) => {
      const response = {
        headers: {
          'x-github-api-version-selected': '2022-11-28',
          deprecation: 'Wed, 27 Nov 2027 14:34:29 GMT',
          sunset: 'Fri, 27 Nov 2028 14:34:29 GMT',
        },
        data: [],
      }
      return mapFn(response)
    })

    await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('closing down'))
  })

  it('isolates an annotation-fetch failure to the affected check run instead of discarding the whole capture', async () => {
    mockPaginate
      .mockResolvedValueOnce([
        {
          id: 4,
          name: 'lint',
          status: 'completed',
          conclusion: 'failure',
          started_at: null,
          completed_at: null,
          html_url: null,
          head_sha: 'commitsha1',
          details_url: null,
          external_id: null,
          check_suite: { id: 12 },
          app: null,
          output: { title: null, summary: null, text: null, annotations_count: 3 },
        },
      ])
      .mockRejectedValueOnce(new Error('annotations endpoint unavailable'))

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.checks).toHaveLength(1)
    expect(result?.checks_passed).toBe(false)
    expect(result?.isDefinitive).toBe(true)
    expect(result?.rawSnapshot.checkRuns[0].annotations).toBeNull()
    expect(result?.rawSnapshot.checkRuns[0].annotationsFetchFailed).toBe(true)
  })

  it('returns isDefinitive=false when a check run is still in progress', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 9,
        name: 'test',
        status: 'in_progress',
        conclusion: null,
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.isDefinitive).toBe(false)
    expect(result?.checks_passed).toBeNull()
  })

  it('returns isDefinitive=true when all check runs have completed', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 10,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 10 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.isDefinitive).toBe(true)
  })
})

describe('getChecksForCommit check_suite_id scoping', () => {
  beforeEach(() => {
    mockListForRef.mockReset()
    mockListAnnotations.mockReset()
    mockPaginate.mockReset()
  })

  it('only returns check runs belonging to the given check_suite_id, ignoring unrelated check runs on the same SHA', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 100 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
      {
        id: 2,
        name: 'Dependabot',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 999 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1', null, 100)

    expect(result?.checks).toHaveLength(1)
    expect(result?.checks[0].name).toBe('build')
    expect(result.matchedCheckSuiteId).toBe(100)
  })

  it('falls back to all check runs when none match the given check_suite_id', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 2,
        name: 'Dependabot',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 999 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1', null, 100)

    expect(result?.checks).toHaveLength(1)
    expect(result?.checks[0].name).toBe('Dependabot')
    expect(result.matchedCheckSuiteId).toBeNull()
  })

  it('does not filter when no check_suite_id is given', async () => {
    mockPaginate.mockResolvedValueOnce([
      {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 100 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
      {
        id: 2,
        name: 'Dependabot',
        status: 'completed',
        conclusion: 'success',
        started_at: null,
        completed_at: null,
        html_url: null,
        head_sha: 'commitsha1',
        details_url: null,
        external_id: null,
        check_suite: { id: 999 },
        app: null,
        output: { title: null, summary: null, text: null, annotations_count: 0 },
      },
    ])

    const result = await getChecksForCommit('navikt', 'nda', 'commitsha1')

    expect(result?.checks).toHaveLength(2)
  })
})
