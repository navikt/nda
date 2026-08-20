import { describe, expect, it } from 'vitest'
import { parseCheckRunsSnapshot } from '~/lib/github/checks-snapshot'

const SCHEMA_V1_FIXTURE = {
  schemaVersion: 1,
  checkRuns: [
    {
      id: 123456789,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T10:00:00Z',
      completed_at: '2026-01-01T10:05:00Z',
      html_url: 'https://github.com/navikt/nda/runs/123456789',
      head_sha: 'abc123def456',
      details_url: 'https://github.com/navikt/nda/actions/runs/1',
      external_id: 'ext-1',
      check_suite: { id: 999 },
      app: { name: 'GitHub Actions', slug: 'github-actions' },
      output: {
        title: 'Build passed',
        summary: 'All good',
        text: null,
        annotations_count: 1,
      },
      annotations: [
        {
          path: 'app/lib/example.ts',
          start_line: 10,
          end_line: 10,
          start_column: 1,
          end_column: 5,
          annotation_level: 'warning',
          message: 'Unused variable',
          title: null,
          raw_details: null,
        },
      ],
    },
    {
      id: 987654321,
      name: 'lint',
      status: 'completed',
      conclusion: 'skipped',
      started_at: null,
      completed_at: null,
      html_url: null,
      head_sha: 'abc123def456',
      details_url: null,
      external_id: null,
      check_suite: null,
      app: null,
      output: null,
      annotations: null,
    },
  ],
}

describe('parseCheckRunsSnapshot — schema v1 (frozen contract)', () => {
  it('parses a schema v1 raw snapshot as it was written to production', () => {
    const result = parseCheckRunsSnapshot(SCHEMA_V1_FIXTURE)

    expect(result).not.toBeNull()
    expect(result?.checks_passed).toBe(true)
    expect(result?.checks).toHaveLength(2)

    expect(result?.checks[0]).toEqual({
      id: 123456789,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-01-01T10:00:00Z',
      completed_at: '2026-01-01T10:05:00Z',
      html_url: 'https://github.com/navikt/nda/runs/123456789',
      head_sha: 'abc123def456',
      details_url: 'https://github.com/navikt/nda/actions/runs/1',
      external_id: 'ext-1',
      check_suite_id: 999,
      app: { name: 'GitHub Actions', slug: 'github-actions' },
      output: {
        title: 'Build passed',
        summary: 'All good',
        text: null,
        annotations_count: 1,
      },
      annotations: [
        {
          path: 'app/lib/example.ts',
          start_line: 10,
          end_line: 10,
          start_column: 1,
          end_column: 5,
          annotation_level: 'warning',
          message: 'Unused variable',
          title: null,
          raw_details: null,
        },
      ],
    })

    expect(result?.checks[1]).toEqual({
      id: 987654321,
      name: 'lint',
      status: 'completed',
      conclusion: 'skipped',
      started_at: null,
      completed_at: null,
      html_url: null,
      head_sha: 'abc123def456',
      details_url: null,
      external_id: null,
      check_suite_id: null,
      app: null,
      output: null,
      annotations: null,
    })
  })

  it('returns null for an unrecognized/future schema version instead of misinterpreting the shape', () => {
    const result = parseCheckRunsSnapshot({ schemaVersion: 999, checkRuns: [] })

    expect(result).toBeNull()
  })

  it('returns null for data that does not look like a checks snapshot at all', () => {
    expect(parseCheckRunsSnapshot(null)).toBeNull()
    expect(parseCheckRunsSnapshot({})).toBeNull()
    expect(parseCheckRunsSnapshot({ checks: [] })).toBeNull()
  })

  it('computes checks_passed=false when any check run failed', () => {
    const result = parseCheckRunsSnapshot({
      schemaVersion: 1,
      checkRuns: [{ ...SCHEMA_V1_FIXTURE.checkRuns[0], conclusion: 'failure' }],
    })

    expect(result?.checks_passed).toBe(false)
  })

  it('computes checks_passed=null when there are no check runs', () => {
    const result = parseCheckRunsSnapshot({ schemaVersion: 1, checkRuns: [] })

    expect(result?.checks_passed).toBeNull()
  })
})
