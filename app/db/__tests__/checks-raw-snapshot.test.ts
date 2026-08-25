import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { pool } from '~/db/connection.server'
import {
  getDerivedChecksDataFromRawSnapshot,
  getLatestDefinitiveChecksRawSnapshot,
  saveChecksRawSnapshot,
} from '~/db/github-data.server'
import type { RawCheckRun } from '~/lib/github/checks-snapshot'

const mockPoolQuery = pool.query as Mock

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
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 9 }] })

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
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('github_checks_raw_snapshots'), [
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
