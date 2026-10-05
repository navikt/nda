import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  identity: vi.fn(),
  capabilities: vi.fn(),
  createComment: vi.fn(),
  update: vi.fn(),
  save: vi.fn(),
  propagate: vi.fn(),
  base: vi.fn(),
  baseline: vi.fn(),
  verify: vi.fn(),
  client: { query: vi.fn(), release: vi.fn() },
}))

vi.mock('~/db/connection.server', () => ({
  withTransaction: async (fn: (client: typeof mocks.client) => Promise<unknown>) => {
    await mocks.client.query('BEGIN')
    try {
      const result = await fn(mocks.client)
      await mocks.client.query('COMMIT')
      return result
    } catch (error) {
      await mocks.client.query('ROLLBACK')
      throw error
    } finally {
      mocks.client.release()
    }
  },
  pool: { query: vi.fn() },
}))
vi.mock('~/db/deployments.server', () => ({
  getDeploymentById: mocks.deployment,
  updateDeploymentFourEyes: mocks.update,
  recordBaselineApproval: mocks.baseline,
  updateDeploymentLegacyData: vi.fn(),
}))
vi.mock('~/db/comments.server', () => ({
  createComment: mocks.createComment,
  deleteComment: vi.fn(),
  deleteLegacyInfo: vi.fn(),
  getLegacyInfo: vi.fn().mockResolvedValue({ registered_by: 'Z990002' }),
}))
vi.mock('~/lib/auth.server', () => ({ getUserIdentity: mocks.identity }))
vi.mock('~/lib/verification', () => ({ runVerification: mocks.verify }))
vi.mock('~/lib/authorization.server', () => ({ resolveDeploymentCapabilities: mocks.capabilities }))
vi.mock('~/db/github-data.server', () => ({ saveVerificationRun: mocks.save }))
vi.mock('~/db/monorepo.server', () => ({ propagateVerificationToSiblings: mocks.propagate }))
vi.mock('~/db/user-github-lookups.server', () => ({ getGithubUserLookups: vi.fn().mockResolvedValue(new Map()) }))
vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp: vi.fn().mockResolvedValue({ repository: { github_repo_id: '9001' } }),
}))
vi.mock('~/db/verification-diff.server', () => ({ getEffectiveComparisonBaseSha: mocks.base }))

import { action } from '../$id.actions.server'

describe('manual approval recorded range', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.save.mockReset()
    mocks.propagate.mockReset()
    mocks.client.query.mockReset().mockResolvedValue({ rows: [{ four_eyes_status: 'pending_baseline' }] })
    mocks.deployment.mockResolvedValue({
      id: 10,
      monitored_app_id: 20,
      commit_sha: 'head',
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'monorepo',
      github_pr_data: null,
      unverified_commits: null,
      four_eyes_status: 'pending_baseline',
    })
    mocks.identity.mockResolvedValue({ navIdent: 'Z990001' })
    mocks.capabilities.mockResolvedValue({ canApprove: true })
    mocks.base.mockResolvedValue('base')
    mocks.baseline.mockResolvedValue(true)
  })

  function approve(intent: string, withRange = true) {
    if (intent === 'approve_legacy') {
      mocks.client.query.mockResolvedValue({ rows: [{ four_eyes_status: 'pending_approval' }] })
    }
    const form = new FormData()
    form.set('intent', intent)
    if (withRange) {
      form.set('comparison_head_sha', 'head')
      form.set('comparison_base_sha', 'base')
    }
    return action({
      request: new Request('http://localhost/deployments/10', { method: 'POST', body: form }),
      params: { id: '10' },
      url: new URL('http://localhost/deployments/10'),
    })
  }

  it('rejects reverification of a protected baseline without creating a new run', async () => {
    mocks.deployment.mockResolvedValue({
      id: 10,
      monitored_app_id: 20,
      commit_sha: 'head',
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'monorepo',
      four_eyes_status: 'baseline',
      default_branch: 'main',
    })
    mocks.capabilities.mockResolvedValue({ canVerify: true })
    expect(await approve('verify_four_eyes', false)).toEqual({
      error: 'Godkjenningen er beskyttet og kan ikke reverifiseres.',
    })
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.client.query).not.toHaveBeenCalled()
  })

  it.each(['manual_approval', 'approve_legacy'])('records the reviewed range before propagating %s', async (intent) => {
    const result = await approve(intent)
    expect(result).toHaveProperty('success')
    expect(mocks.save).toHaveBeenCalledWith(
      10,
      { status: 'manually_approved', result: { comparisonRange: { baseSha: 'base', headSha: 'head' } } },
      { prSnapshotIds: [], commitSnapshotIds: [] },
      mocks.client,
    )
    expect(mocks.createComment).toHaveBeenCalledWith(expect.any(Object), mocks.client)
    expect(mocks.update).toHaveBeenCalledWith(10, expect.any(Object), expect.any(Object), mocks.client)
    expect(mocks.client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT four_eyes_status FROM deployments WHERE id = $1 FOR UPDATE', [10]],
      ['COMMIT'],
    ])
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.propagate.mock.invocationCallOrder[0])
  })

  it.each(['manual_approval', 'approve_legacy'])(
    'rejects a stale reviewed interval before mutating %s',
    async (intent) => {
      mocks.base.mockResolvedValue('changed-base')
      expect(await approve(intent)).toHaveProperty('error')
      expect(mocks.createComment).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
      expect(mocks.propagate).not.toHaveBeenCalled()
    },
  )

  it('keeps an approval without displayed range local and records no synthetic range', async () => {
    const result = await approve('manual_approval', false)
    expect(result).toEqual({
      success: 'Deployment manuelt godkjent. Godkjenningen deles ikke fordi sammenligningsintervallet mangler.',
    })
    expect(mocks.save).toHaveBeenCalledWith(
      10,
      { status: 'manually_approved', result: { comparisonRange: null } },
      { prSnapshotIds: [], commitSnapshotIds: [] },
      mocks.client,
    )
    expect(mocks.propagate).not.toHaveBeenCalled()
  })

  it.each(['manual_approval', 'approve_legacy', 'approve_baseline'])(
    'rolls back and does not propagate when recording approval fails for %s',
    async (intent) => {
      mocks.save.mockRejectedValue(new Error('Run insert failed'))
      expect(await approve(intent)).toHaveProperty('error')
      expect(mocks.client.query.mock.calls[0]).toEqual(['BEGIN'])
      expect(mocks.client.query.mock.calls.at(-1)).toEqual(['ROLLBACK'])
      expect(mocks.client.release).toHaveBeenCalledOnce()
      expect(mocks.propagate).not.toHaveBeenCalled()
    },
  )

  it('records a baseline range without propagating', async () => {
    expect(await approve('approve_baseline')).toHaveProperty('success')
    expect(mocks.save).toHaveBeenCalledWith(
      10,
      { status: 'baseline', result: { comparisonRange: { baseSha: 'base', headSha: 'head' } } },
      { prSnapshotIds: [], commitSnapshotIds: [] },
      mocks.client,
    )
    expect(mocks.propagate).not.toHaveBeenCalled()
    expect(mocks.client.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT four_eyes_status FROM deployments WHERE id = $1 FOR UPDATE', [10]],
      ['COMMIT'],
    ])
  })

  it.each(['baseline', 'manually_approved', 'legacy', 'unverifiable'])(
    'rejects a manual approval when the locked status became protected: %s',
    async (status) => {
      mocks.client.query.mockResolvedValue({ rows: [{ four_eyes_status: status }] })
      expect(await approve('manual_approval')).toEqual({
        error: 'Godkjenningen er beskyttet og kan ikke overskrives. Last siden på nytt.',
      })
      expect(mocks.createComment).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
      expect(mocks.propagate).not.toHaveBeenCalled()
    },
  )

  it.each(['manually_approved', 'legacy', 'approved', 'pending_approval'])(
    'rejects a baseline POST for unchanged but ineligible status %s',
    async (status) => {
      const deployment = await mocks.deployment()
      mocks.deployment.mockResolvedValue({ ...deployment, four_eyes_status: status })
      mocks.client.query.mockResolvedValue({ rows: [{ four_eyes_status: status }] })
      expect(await approve('approve_baseline')).toHaveProperty('error')
      expect(mocks.baseline).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it.each(['baseline', 'manually_approved', 'legacy'])(
    'rejects legacy approval when the locked status is %s',
    async (status) => {
      mocks.client.query.mockResolvedValueOnce({ rows: [] })
      mocks.client.query.mockResolvedValueOnce({ rows: [{ four_eyes_status: status }] })
      expect(await approve('approve_legacy')).toHaveProperty('error')
      expect(mocks.createComment).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
      expect(mocks.propagate).not.toHaveBeenCalled()
    },
  )

  it('records the range when attributing an existing baseline approval', async () => {
    mocks.client.query.mockResolvedValue({ rows: [{ four_eyes_status: 'baseline' }] })
    mocks.deployment.mockResolvedValue({
      id: 10,
      monitored_app_id: 20,
      commit_sha: 'head',
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'monorepo',
      four_eyes_status: 'baseline',
    })
    expect(await approve('approve_baseline')).toHaveProperty('success')
    expect(mocks.baseline).toHaveBeenCalledWith(10, 'Z990001', mocks.client)
    expect(mocks.save).toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.propagate).not.toHaveBeenCalled()
  })

  it('rejects a stale baseline interval without changing status', async () => {
    mocks.base.mockResolvedValue('changed-base')
    expect(await approve('approve_baseline')).toHaveProperty('error')
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.baseline).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.client.query).not.toHaveBeenCalled()
  })

  it('does not overwrite recorded evidence when baseline approval is already attributed', async () => {
    mocks.client.query.mockResolvedValue({ rows: [{ four_eyes_status: 'baseline' }] })
    mocks.deployment.mockResolvedValue({
      id: 10,
      monitored_app_id: 20,
      commit_sha: 'head',
      detected_github_owner: 'navikt',
      detected_github_repo_name: 'monorepo',
      four_eyes_status: 'baseline',
    })
    mocks.baseline.mockResolvedValue(false)
    expect(await approve('approve_baseline')).toEqual({
      error: 'Baseline er allerede godkjent eller statusen er endret. Last siden på nytt.',
    })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.propagate).not.toHaveBeenCalled()
  })

  it('rejects a baseline approval when another approval changed the locked status', async () => {
    mocks.client.query.mockResolvedValue({ rows: [{ four_eyes_status: 'baseline' }] })
    expect(await approve('approve_baseline')).toHaveProperty('error')
    expect(mocks.baseline).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.propagate).not.toHaveBeenCalled()
  })

  it.each([
    { intent: 'manual_approval', label: 'Deployment manuelt godkjent' },
    { intent: 'approve_legacy', label: 'Legacy deployment godkjent' },
  ])('reports the committed approval when propagation fails for $intent', async ({ intent, label }) => {
    mocks.propagate.mockRejectedValue(new Error('Propagation failed'))
    expect(await approve(intent)).toEqual({
      success: `${label}, men delingen av godkjenningen til andre leveranser feilet.`,
    })
    expect(mocks.createComment).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.client.query.mock.calls.at(-1)).toEqual(['COMMIT'])
    expect(mocks.client.query.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.propagate.mock.invocationCallOrder[0])
  })
})
