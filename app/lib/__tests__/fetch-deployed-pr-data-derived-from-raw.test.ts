import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getAllLatestPrRawSnapshots: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  savePrRawSnapshotsBatch: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getDetailedPullRequestInfo: vi.fn(),
  getDisplayDataFromGitHub: vi.fn(),
  getMutablePrDataFromGitHub: vi.fn(),
  getPullRequestForCommit: vi.fn(),
}))

import { getAllLatestPrRawSnapshots, getLatestCommitSnapshot } from '~/db/github-data.server'
import { fetchDeployedPrData } from '~/lib/verification/fetch-data/pr-data.server'
import { CURRENT_SCHEMA_VERSION } from '~/lib/verification/types'

const mockGetAllLatestPrRawSnapshots = getAllLatestPrRawSnapshots as Mock
const mockGetLatestCommitSnapshot = getLatestCommitSnapshot as Mock

const rawPr = {
  base: { ref: 'main', sha: 'base123', repo: { id: 42 } },
  head: { ref: 'feature', sha: 'head123' },
  title: 'Some PR',
  body: null,
  labels: [],
  created_at: '2026-01-01T00:00:00Z',
  merged_at: '2026-01-02T00:00:00Z',
  merge_commit_sha: 'merge123',
  commits: 1,
  changed_files: 1,
  additions: 1,
  deletions: 1,
  comments: 0,
  review_comments: 0,
  draft: false,
  mergeable: null,
  mergeable_state: null,
  rebaseable: null,
  locked: false,
  maintainer_can_modify: false,
  auto_merge: null,
  user: { login: 'dev', avatar_url: '' },
  merged_by: null,
  assignees: [],
  requested_reviewers: [],
  requested_teams: [],
  milestone: null,
}

function rawSnapshot(data: unknown) {
  return { githubRepoId: 42, data }
}

describe('fetchDeployedPrData derivedFromRaw signal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports derivedFromRaw: true when PR data is derived from a complete raw snapshot without a GitHub call', async () => {
    mockGetLatestCommitSnapshot.mockResolvedValue({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: { prs: [{ number: 7, baseBranch: 'main' }] },
    })

    const map = new Map()
    map.set('pr', rawSnapshot(rawPr))
    map.set(
      'reviews',
      rawSnapshot([{ user: { login: 'r1', avatar_url: '' }, state: 'APPROVED', submitted_at: '2026-01-01T11:00:00Z' }]),
    )
    map.set(
      'commits',
      rawSnapshot([
        {
          sha: 'c1',
          commit: { message: 'feat', author: { date: '2026-01-01T10:00:00Z' } },
          author: { login: 'user1' },
        },
      ]),
    )
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(map)

    const result = await fetchDeployedPrData('navikt', 'nda', 'a'.repeat(40), 'main')

    expect(result.deployedPr).not.toBeNull()
    expect(result.derivedFromRaw).toBe(true)
  })
})
