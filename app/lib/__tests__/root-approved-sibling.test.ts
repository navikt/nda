import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

const { findRootApprovedSiblingForCommit, preferRootApprovedSibling } = await import(
  '../verification/fetch-data/previous-deployment.server'
)

describe('findRootApprovedSiblingForCommit', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
  })

  it('queries only for root-approved statuses, excluding verified_via_sibling', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await findRootApprovedSiblingForCommit('sha-abc', 'repo-1')

    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain("d.four_eyes_status IN ('approved'")
    expect(query).not.toContain("'verified_via_sibling'")
  })

  it('matches exact ranges while excluding roots from the current deployment application', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 'base-sha')

    const [query, params] = mockPoolQuery.mock.calls[0]
    expect(query).toContain("recorded.comparison_range->>'baseSha' IS NOT DISTINCT FROM $3::text")
    expect(query).not.toContain('d.id <=')
    expect(query).toContain('current.monitored_app_id = d.monitored_app_id')
    expect(query).not.toContain('(d.created_at, d.id) >= (current.created_at, current.id)')
    expect(query).toContain('ORDER BY d.created_at ASC, d.id ASC')
    expect(params).toEqual(['repo-1', 'sha-abc', 'base-sha', null, null])
  })

  it('excludes the deployment being verified from root lookup', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 'base-sha', 42)

    const [query, params] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('d.id != $4')
    expect(params).toEqual(['repo-1', 'sha-abc', 'base-sha', 42, null])
  })

  it('excludes same-app roots when the current application is explicitly supplied', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 'sha-abc', 42, 7)

    const [query, params] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('latest.status = d.four_eyes_status')
    expect(query).toContain('d.monitored_app_id != $5')
    expect(params).toEqual(['repo-1', 'sha-abc', 'sha-abc', 42, 7])
  })

  it('does not bypass recorded range matching when excluding same-app roots', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 'sha-abc', 42, 7)

    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).not.toContain('OR (d.monitored_app_id = $5 AND $3 = $2)')
    expect(query).not.toContain('OR d.monitored_app_id = $5)')
  })

  it('returns the oldest matching sibling when found', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          commit_sha: 'sha-abc',
          created_at: new Date('2026-01-01T00:00:00Z'),
          monitored_app_id: 10,
          four_eyes_status: 'approved',
        },
      ],
    })

    const result = await findRootApprovedSiblingForCommit('sha-abc', 'repo-1')

    expect(result).toEqual({
      id: 1,
      monitoredAppId: 10,
      fourEyesStatus: 'approved',
      comparisonBaseSha: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('returns null when no root-approved sibling exists', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const result = await findRootApprovedSiblingForCommit('sha-abc', 'repo-1')

    expect(result).toBeNull()
  })
})

describe('preferRootApprovedSibling', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
  })

  it('returns the candidate unchanged when it is null', async () => {
    const result = await preferRootApprovedSibling(null, 'sha-abc', 'repo-1', 1)
    expect(result).toBeNull()
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns the candidate unchanged when githubRepoId is missing', async () => {
    const candidate = { id: 2, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'approved' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', null, 1)
    expect(result).toBe(candidate)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns the candidate unchanged when it is not the same commit (no_changes path, not sibling)', async () => {
    const candidate = { id: 2, commitSha: 'sha-other', monitoredAppId: 2, fourEyesStatus: 'approved' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1)
    expect(result).toBe(candidate)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns the candidate unchanged when it belongs to the same app (true no_changes, not sibling)', async () => {
    const candidate = { id: 2, commitSha: 'sha-abc', monitoredAppId: 1, fourEyesStatus: 'no_changes' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1)
    expect(result).toBe(candidate)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('re-attributes a sibling candidate (B) to the true root (A) in a chain A -> B -> C', async () => {
    // B (app 2) is the nearest candidate for C (app 3), but B was itself only
    // verified_via_sibling against A (app 1, the true root, status approved).
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 100,
          created_at: new Date('2026-01-01T00:00:00Z'),
          monitored_app_id: 1,
          four_eyes_status: 'approved',
        },
      ],
    })

    const candidateB = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'verified_via_sibling' }
    const result = await preferRootApprovedSibling(candidateB, 'sha-abc', 'repo-1', 3)

    expect(result).toEqual({
      id: 100,
      commitSha: 'sha-abc',
      monitoredAppId: 1,
      fourEyesStatus: 'approved',
      comparisonBaseSha: null,
      canShareApproval: true,
    })
  })

  it('passes the expected comparison base SHA through to the root lookup', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const candidate = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'verified_via_sibling' }
    await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 3, 'base-sha', 42)

    const [, params] = mockPoolQuery.mock.calls[0]
    expect(params).toEqual(['repo-1', 'sha-abc', 'base-sha', 42, 3])
  })

  it('keeps the sibling candidate when no root from another app exists and excludes the current app', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const candidateB = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'verified_via_sibling' }
    const result = await preferRootApprovedSibling(candidateB, 'sha-abc', 'repo-1', 1)

    expect(result).toBe(candidateB)
    const [sql, params] = mockPoolQuery.mock.calls[0]
    expect(params).toEqual(['repo-1', 'sha-abc', null, null, 1])
    expect(sql).toContain('d.monitored_app_id != $5')
  })

  it('keeps the candidate unchanged when the root lookup finds the same deployment', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 200,
          created_at: new Date('2026-01-01T00:00:00Z'),
          monitored_app_id: 2,
          four_eyes_status: 'approved',
        },
      ],
    })

    const candidate = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'approved' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1)

    expect(result).toBe(candidate)
  })

  it('keeps the candidate unchanged when no root-approved sibling is found', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const candidate = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'pending' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1)

    expect(result).toBe(candidate)
  })
})
