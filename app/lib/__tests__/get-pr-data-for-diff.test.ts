import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/github-data.server', () => ({
  getAllLatestPrSnapshots: vi.fn(),
  getAllLatestPrRawSnapshots: vi.fn(),
  getLatestCommitSnapshot: vi.fn(),
  saveCommitSnapshot: vi.fn(),
  savePrRawSnapshotsBatch: vi.fn(),
}))

import { getAllLatestPrRawSnapshots, getAllLatestPrSnapshots } from '~/db/github-data.server'
import { getPrDataForDiff } from '~/lib/verification/fetch-data/pr-data.server'

const mockGetAllLatestPrRawSnapshots = getAllLatestPrRawSnapshots as Mock
const mockGetAllLatestPrSnapshots = getAllLatestPrSnapshots as Mock

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

describe('getPrDataForDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllLatestPrSnapshots.mockResolvedValue(new Map())
  })

  it('returns PR data derived from a complete raw snapshot', async () => {
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

    const result = await getPrDataForDiff('navikt', 'nda', 100)

    expect(result).not.toBeNull()
    expect(result?.metadata.title).toBe('Some PR')
    expect(result?.reviews).toHaveLength(1)
    expect(result?.commits).toHaveLength(1)
    expect(mockGetAllLatestPrSnapshots).not.toHaveBeenCalled()
  })

  it('falls back to legacy snapshots when the raw snapshot is only partially populated (pr but no reviews/commits)', async () => {
    const partialRaw = new Map()
    partialRaw.set('pr', rawSnapshot(rawPr))
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(partialRaw)

    const legacyMap = new Map()
    legacyMap.set('metadata', { data: { title: 'Legacy PR', base_branch: 'main', merged_at: '2026-01-02T00:00:00Z' } })
    legacyMap.set('reviews', {
      data: [{ username: 'legacy-reviewer', state: 'APPROVED', submitted_at: '2026-01-01T11:00:00Z' }],
    })
    legacyMap.set('commits', {
      data: [{ sha: 'legacy-c1', message: 'legacy feat', author: { username: 'user1' }, date: '2026-01-01T10:00:00Z' }],
    })
    mockGetAllLatestPrSnapshots.mockResolvedValue(legacyMap)

    const result = await getPrDataForDiff('navikt', 'nda', 100)

    expect(result).not.toBeNull()
    expect(result?.metadata.title).toBe('Legacy PR')
    expect(result?.reviews).toHaveLength(1)
    expect(result?.commits).toHaveLength(1)
  })

  it('returns null when neither raw nor legacy snapshots contain reviews/commits', async () => {
    mockGetAllLatestPrRawSnapshots.mockResolvedValue(new Map())

    const legacyMap = new Map()
    legacyMap.set('metadata', { data: { title: 'Legacy PR', base_branch: 'main', merged_at: null } })
    mockGetAllLatestPrSnapshots.mockResolvedValue(legacyMap)

    const result = await getPrDataForDiff('navikt', 'nda', 100)

    expect(result).toBeNull()
  })
})
