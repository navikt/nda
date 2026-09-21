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

    await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 999)

    const [query] = mockPoolQuery.mock.calls[0]
    expect(query).toContain("d.four_eyes_status IN ('approved'")
    expect(query).not.toContain("'verified_via_sibling'")
  })

  it('bounds the query to deployments created no later than the deployment being verified', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 999)

    const [query, params] = mockPoolQuery.mock.calls[0]
    expect(query).toContain('d.id <= $3')
    expect(params).toEqual(['repo-1', 'sha-abc', 999])
  })

  it('returns the oldest matching sibling when found', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 1, monitored_app_id: 10, four_eyes_status: 'approved' }],
    })

    const result = await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 999)

    expect(result).toEqual({ id: 1, monitoredAppId: 10, fourEyesStatus: 'approved' })
  })

  it('returns null when no root-approved sibling exists', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const result = await findRootApprovedSiblingForCommit('sha-abc', 'repo-1', 999)

    expect(result).toBeNull()
  })
})

describe('preferRootApprovedSibling', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
  })

  it('returns the candidate unchanged when it is null', async () => {
    const result = await preferRootApprovedSibling(null, 'sha-abc', 'repo-1', 1, 100)
    expect(result).toBeNull()
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns the candidate unchanged when githubRepoId is missing', async () => {
    const candidate = { id: 2, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'approved' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', null, 1, 100)
    expect(result).toBe(candidate)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns the candidate unchanged when it is not the same commit (no_changes path, not sibling)', async () => {
    const candidate = { id: 2, commitSha: 'sha-other', monitoredAppId: 2, fourEyesStatus: 'approved' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1, 100)
    expect(result).toBe(candidate)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('returns the candidate unchanged when it belongs to the same app (true no_changes, not sibling)', async () => {
    const candidate = { id: 2, commitSha: 'sha-abc', monitoredAppId: 1, fourEyesStatus: 'no_changes' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1, 100)
    expect(result).toBe(candidate)
    expect(mockPoolQuery).not.toHaveBeenCalled()
  })

  it('re-attributes a sibling candidate (B) to the true root (A) in a chain A -> B -> C', async () => {
    // B (app 2) is the nearest candidate for C (app 3), but B was itself only
    // verified_via_sibling against A (app 1, the true root, status approved).
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 100, monitored_app_id: 1, four_eyes_status: 'approved' }],
    })

    const candidateB = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'verified_via_sibling' }
    const result = await preferRootApprovedSibling(candidateB, 'sha-abc', 'repo-1', 3, 300)

    expect(result).toEqual({
      id: 100,
      commitSha: 'sha-abc',
      monitoredAppId: 1,
      fourEyesStatus: 'approved',
    })
  })

  it('passes the current deployment id through as the root-lookup bound', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const candidate = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'verified_via_sibling' }
    await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 3, 300)

    const [, params] = mockPoolQuery.mock.calls[0]
    expect(params).toEqual(['repo-1', 'sha-abc', 300])
  })

  it('re-attributes to the current app itself when it holds the true root (same-app redeploy racing a sibling)', async () => {
    // Regression: app A (id 1) had commit X approved earlier (deployment 100). Sibling app B
    // (id 2) then deployed the same commit X and got verified_via_sibling against A (deployment
    // 200). App A now redeploys commit X again (deployment 300) — the nearest previousDeployment
    // candidate is B's verified_via_sibling row (more recent than A's own original deployment),
    // but the true root is A's own earlier deployment. The root lookup must be able to find it
    // even though it belongs to the current app, so this correctly resolves as a same-app
    // "no_changes" redeploy instead of an unresolved sibling verification.
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 100, monitored_app_id: 1, four_eyes_status: 'approved' }],
    })

    const candidateB = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'verified_via_sibling' }
    const result = await preferRootApprovedSibling(candidateB, 'sha-abc', 'repo-1', 1, 300)

    expect(result).toEqual({
      id: 100,
      commitSha: 'sha-abc',
      monitoredAppId: 1,
      fourEyesStatus: 'approved',
    })
  })

  it('keeps the candidate unchanged when the root lookup finds the same deployment', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 200, monitored_app_id: 2, four_eyes_status: 'approved' }],
    })

    const candidate = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'approved' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1, 300)

    expect(result).toBe(candidate)
  })

  it('keeps the candidate unchanged when no root-approved sibling is found', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] })

    const candidate = { id: 200, commitSha: 'sha-abc', monitoredAppId: 2, fourEyesStatus: 'pending' }
    const result = await preferRootApprovedSibling(candidate, 'sha-abc', 'repo-1', 1, 300)

    expect(result).toBe(candidate)
  })
})
