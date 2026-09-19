import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClientQuery, mockClient, mockPoolQuery } = vi.hoisted(() => {
  const mockClientQuery = vi.fn()
  return {
    mockClientQuery,
    mockClient: { query: mockClientQuery, release: vi.fn() },
    mockPoolQuery: vi.fn(),
  }
})

vi.mock('~/db/connection.server', () => ({
  pool: { connect: vi.fn(async () => mockClient), query: mockPoolQuery },
}))

import {
  getDerivedChecksDataFromRawSnapshot,
  getLatestDefinitiveChecksRawSnapshot,
  saveChecksRawSnapshot,
} from '~/db/github-data.server'
import type { RawCheckRun } from '~/lib/github/checks-snapshot'

const rawCheckRun = {
  id: 1,
  name: 'build',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-01-01T00:00:00Z',
  completed_at: '2026-01-01T00:05:00Z',
  html_url: 'https://github.com/navikt/nda/runs/1',
  head_sha: 'a'.repeat(40),
  node_id: 'node-1',
  url: 'https://api.github.com/repos/navikt/nda/check-runs/1',
  external_id: '',
  pull_requests: [],
  details_url: null,
  check_suite: { id: 42 },
  app: null,
  output: null,
  annotations: null,
} as unknown as RawCheckRun

describe('saveChecksRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts the raw check runs into github_checks_raw_snapshots', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 9 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const observedAt = new Date('2026-01-01T00:00:00Z')
    const id = await saveChecksRawSnapshot(
      'navikt',
      'nda',
      999,
      'a'.repeat(40),
      42,
      true,
      [rawCheckRun],
      apiVersion,
      observedAt,
    )

    expect(id).toBe(9)
    const insertCall = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('github_checks_raw_snapshots'))
    expect(insertCall?.[1]).toEqual([
      999,
      'navikt',
      'nda',
      'a'.repeat(40),
      42,
      true,
      apiVersion.apiVersion,
      apiVersion.apiDeprecatedAt,
      apiVersion.apiSunsetAt,
      observedAt,
      JSON.stringify([rawCheckRun]),
    ])
  })

  it('acquires an advisory lock scoped to the repo/sha/check-suite before the dedup check', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ id: 9 }] })

    const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }
    const observedAt = new Date('2026-01-01T00:00:00Z')
    await saveChecksRawSnapshot('navikt', 'nda', 999, 'a'.repeat(40), 42, true, [rawCheckRun], apiVersion, observedAt)

    const calls = mockClientQuery.mock.calls
    expect(calls[0]).toEqual(['BEGIN'])
    expect(calls[1][0]).toContain('pg_advisory_xact_lock')
    expect(calls[1][1]).toEqual([expect.any(Number), `999:${'a'.repeat(40)}:42`])
    const [query] = calls[2]
    expect(query).toContain('last_snapshot')
    expect(query).toContain('NOT EXISTS')
    expect(query).toContain('IS NOT DISTINCT FROM')
    expect(query).toContain('is_definitive = $6')
    expect(calls[3]).toEqual(['COMMIT'])
  })
})

describe('getLatestDefinitiveChecksRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no definitive raw snapshot exists', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getLatestDefinitiveChecksRawSnapshot('navikt', 'nda', 'a'.repeat(40))

    expect(result).toBeNull()
  })

  it('queries for the latest snapshot regardless of definitiveness, then only reuses it if definitive', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    await getLatestDefinitiveChecksRawSnapshot('navikt', 'nda', 'a'.repeat(40))

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.not.stringContaining('is_definitive = true'), [
      'navikt',
      'nda',
      'a'.repeat(40),
      null,
    ])
  })

  it('returns null when the latest snapshot for the sha/suite is not yet definitive, even if an older definitive one exists', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 4,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          sha: 'a'.repeat(40),
          check_suite_id: 42,
          is_definitive: false,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: new Date('2026-01-02T00:00:00Z'),
          data: [],
        },
      ],
    })

    const result = await getLatestDefinitiveChecksRawSnapshot('navikt', 'nda', 'a'.repeat(40))

    expect(result).toBeNull()
  })

  it('returns the latest definitive raw snapshot for the given sha', async () => {
    const fetchedAt = new Date('2026-01-01T00:00:00Z')
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 3,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          sha: 'a'.repeat(40),
          check_suite_id: 42,
          is_definitive: true,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: fetchedAt,
          data: [rawCheckRun],
        },
      ],
    })

    const result = await getLatestDefinitiveChecksRawSnapshot('navikt', 'nda', 'a'.repeat(40))

    expect(result).toEqual({
      id: 3,
      owner: 'navikt',
      repo: 'nda',
      githubRepoId: 999,
      sha: 'a'.repeat(40),
      checkSuiteId: 42,
      isDefinitive: true,
      apiVersion: '2022-11-28',
      apiDeprecatedAt: null,
      apiSunsetAt: null,
      fetchedAt,
      data: [rawCheckRun],
    })
  })
})

describe('getDerivedChecksDataFromRawSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no definitive raw snapshot exists', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] })

    const result = await getDerivedChecksDataFromRawSnapshot('navikt', 'nda', 'a'.repeat(40))

    expect(result).toBeNull()
  })

  it('maps the stored raw check runs into checks_passed and checks', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 3,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          sha: 'a'.repeat(40),
          check_suite_id: 42,
          is_definitive: true,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: new Date('2026-01-01T00:00:00Z'),
          data: [rawCheckRun],
        },
      ],
    })

    const result = await getDerivedChecksDataFromRawSnapshot('navikt', 'nda', 'a'.repeat(40))

    expect(result?.checks_passed).toBe(true)
    expect(result?.checks).toHaveLength(1)
    expect(result?.checks[0].name).toBe('build')
  })

  it('returns null instead of throwing when the stored raw response is malformed', async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 3,
          owner: 'navikt',
          repo: 'nda',
          github_repo_id: 999,
          sha: 'a'.repeat(40),
          check_suite_id: null,
          is_definitive: true,
          api_version: '2022-11-28',
          api_deprecated_at: null,
          api_sunset_at: null,
          fetched_at: new Date('2026-01-01T00:00:00Z'),
          data: 'not-an-array',
        },
      ],
    })

    const result = await getDerivedChecksDataFromRawSnapshot('navikt', 'nda', 'a'.repeat(40))

    expect(result).toBeNull()
  })
})
