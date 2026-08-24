import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery, mockGetAllLatestPrSnapshots, mockGetAllLatestPrRawSnapshots } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetAllLatestPrSnapshots: vi.fn(),
  mockGetAllLatestPrRawSnapshots: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

vi.mock('~/db/commits.server', () => ({
  updateCommitPrVerification: vi.fn(),
}))

vi.mock('~/db/deployments.server', () => ({
  logStatusTransition: vi.fn(),
}))

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: mockGetAllLatestPrSnapshots,
  getAllLatestPrRawSnapshots: mockGetAllLatestPrRawSnapshots,
  saveVerificationRun: vi.fn().mockResolvedValue(1),
  getLatestCommitSnapshot: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  savePrRawSnapshotsBatch: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { updateDeploymentCommitChecks, updateDeploymentVerification } from '~/lib/verification/store-data.server'
import type { VerificationResult } from '~/lib/verification/types'

describe('updateDeploymentCommitChecks', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
  })

  it('writes commit_checks_data and marks commit_checks_checked_at when the fetch was attempted (default)', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 })

    await updateDeploymentCommitChecks(1, {
      checked_sha: 'a'.repeat(40),
      checks_passed: true,
      checks: [],
    })

    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockPoolQuery.mock.calls[0]
    expect(sql).toContain('commit_checks_checked_at = CASE WHEN $3 THEN now() ELSE commit_checks_checked_at END')
    expect(params[0]).toBe(1)
    expect(params[2]).toBe(true)
  })

  it('still updates commit_checks_checked_at even when no checks were found, so the backfill converges', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 })

    await updateDeploymentCommitChecks(1, undefined)

    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
    const [, params] = mockPoolQuery.mock.calls[0]
    expect(params[1]).toBeNull()
    expect(params[2]).toBe(true)
  })

  it('does not touch the database at all when the fetch attempt itself failed (transient error), so it is retried later', async () => {
    await updateDeploymentCommitChecks(1, undefined, false)

    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('writes the partial commit_checks_data but does not mark commit_checks_checked_at when a check run is still in progress', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 })

    await updateDeploymentCommitChecks(
      1,
      {
        checked_sha: 'a'.repeat(40),
        checks_passed: null,
        checks: [
          {
            id: 1,
            name: 'build',
            status: 'in_progress',
            conclusion: null,
            started_at: null,
            completed_at: null,
            html_url: null,
          },
        ],
      },
      false,
    )

    expect(mockPoolQuery).toHaveBeenCalledTimes(1)
    const [, params] = mockPoolQuery.mock.calls[0]
    expect(params[0]).toBe(1)
    expect(params[1]).not.toBeNull()
    expect(params[2]).toBe(false)
  })
})

describe('updateDeploymentVerification legacy checks fallback', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
    mockGetAllLatestPrSnapshots.mockReset()
  })

  function baseResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
    return {
      hasFourEyes: true,
      status: 'approved',
      deployedPr: { number: 42, url: 'https://github.com/navikt/nda/pull/42', title: 'Fix bug', author: 'dev' },
      unverifiedCommits: [],
      approvalDetails: { method: 'pr_review', approvers: ['dev'], reason: 'approved' },
      verifiedAt: new Date(),
      schemaVersion: 1,
      ...overrides,
    }
  }

  it('preserves the legacy github_pr_data.checks fallback when the fresh checks snapshot is empty', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            detected_github_owner: 'navikt',
            detected_github_repo_name: 'nda',
            github_pr_data: {
              checks_passed: false,
              checks: [{ id: 1, name: 'legacy-check', conclusion: 'failure' }],
              checks_ref: 'merge_commit',
            },
          },
        ],
      }) // deploymentResult lookup inside buildGithubPrDataFromSnapshotsForPr
      .mockResolvedValueOnce({ rows: [{ four_eyes_status: 'unverified' }] }) // current status lookup
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE

    mockGetAllLatestPrSnapshots.mockResolvedValueOnce(
      new Map([
        [
          'metadata',
          {
            data: {
              title: 'Fix bug',
              body: null,
              createdAt: '2026-01-01T00:00:00Z',
              baseBranch: 'main',
              baseSha: 'base',
              headBranch: 'feature',
              headSha: 'head',
              mergeCommitSha: 'merge',
              commitsCount: 1,
              changedFiles: 1,
              additions: 1,
              deletions: 1,
              draft: false,
              author: { username: 'dev' },
            },
          },
        ],
        ['checks', { data: { conclusion: null, checkRuns: [], statuses: [] } }],
      ]),
    )

    await updateDeploymentVerification(1, baseResult())

    const updateCall = mockPoolQuery.mock.calls[2]
    const githubPrDataJson = updateCall[1][4]
    const writtenPrData = JSON.parse(githubPrDataJson)

    expect(writtenPrData.checks_passed).toBe(false)
    expect(writtenPrData.checks).toEqual([{ id: 1, name: 'legacy-check', conclusion: 'failure' }])
    expect(writtenPrData.checks_ref).toBe('merge_commit')
  })
})
