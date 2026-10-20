import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  repository: vi.fn(),
  start: vi.fn(),
  register: vi.fn(),
  revoke: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({ requireUser: mocks.user }))
vi.mock('~/lib/repository-resolution.server', () => ({ resolveRepositoryFromParams: mocks.repository }))
vi.mock('~/db/repository-manual-approvals.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/db/repository-manual-approvals.server')>()),
  createRepositoryApprovalReview: mocks.start,
  registerRepositoryManualApproval: mocks.register,
  revokeRepositoryManualApproval: mocks.revoke,
}))

import { RepositoryApprovalError } from '~/db/repository-manual-approvals.server'
import { action as revoke } from './repository.$owner.$repo.admin.code-deliveries.$deliveryId.actions.server'
import { action } from './repository.$owner.$repo.approvals.$deliveryId.actions.server'

const sha = 'b'.repeat(40)
const params = { owner: 'navikt', repo: 'glad-fjord', deliveryId: '17' }
const user = { navIdent: 'Z990003', role: 'user', isActualAdmin: false, adminSuppressed: true, entraGroups: [] }
const valid = {
  intent: 'register-approval',
  snapshotId: '23',
  commitShas: sha,
  reviewedAt: '2026-10-18T12:00:00+02:00',
  reviewDocumentation: ' Gjennomgått kode og tester. ',
  documentationUrl: 'https://example.com/review',
}

function args(
  fields: Record<string, string | string[]> = valid,
  options: { origin?: string; method?: string; repositoryId?: string; deliveryId?: string; site?: string } = {},
) {
  const formData = new FormData()
  for (const [key, values] of Object.entries(fields)) {
    for (const value of Array.isArray(values) ? values : [values]) formData.append(key, value)
  }
  const method = options.method ?? 'POST'
  return {
    params: { ...params, deliveryId: options.deliveryId ?? params.deliveryId },
    request: new Request(
      `http://localhost/repository/navikt/glad-fjord/approvals/17?repositoryId=${options.repositoryId ?? '5'}`,
      {
        method,
        headers: { Origin: options.origin ?? 'http://localhost', 'Sec-Fetch-Site': options.site ?? 'same-origin' },
        ...(method === 'GET' ? {} : { body: formData }),
      },
    ),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue(user)
  mocks.repository.mockResolvedValue({ id: 5, github_owner: 'navikt', github_repo_name: 'glad-fjord' })
  mocks.start.mockResolvedValue({ snapshotId: 23, commits: [{ sha }], reviewer: user.navIdent })
  mocks.register.mockResolvedValue(41)
  mocks.revoke.mockResolvedValue(true)
})

describe('repository manual approval actions', () => {
  it('starts via POST and returns a stored snapshot without registering an approval', async () => {
    const result = await action(args({ intent: 'start-review' }))
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(user, 5, 17)
    expect(result).toMatchObject({ success: expect.any(String), review: { snapshotId: 23, reviewer: 'Z990003' } })
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('passes only the selected subset and uses the authenticated reviewer, ignoring spoofed identity and evidence', async () => {
    const result = await action(args({ ...valid, reviewer: 'Z990001', registeredBy: 'Z990002', evidence: 'spoofed' }))
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith(user, 5, 17, {
      snapshotId: 23,
      commitShas: [sha],
      reviewedAt: new Date('2026-10-18T10:00:00Z'),
      reviewDocumentation: 'Gjennomgått kode og tester.',
      documentationUrl: 'https://example.com/review',
    })
    expect(result).toMatchObject({
      registered: true,
      success: expect.stringContaining('Deploymentstatus er ikke endret'),
    })
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('allows no documentation link but requires the review text', async () => {
    await action(args({ ...valid, documentationUrl: '' }))
    expect(mocks.register).toHaveBeenCalledWith(user, 5, 17, expect.objectContaining({ documentationUrl: null }))
  })

  it.each([
    { reviewDocumentation: '' },
    { reviewDocumentation: '   ' },
    { documentationUrl: 'javascript:alert(1)' },
    { documentationUrl: 'data:text/html,test' },
    { documentationUrl: 'ftp://example.com' },
    { documentationUrl: 'not a url' },
    { documentationUrl: 'https:example.com/review' },
    { documentationUrl: 'http:/example.com' },
    { documentationUrl: 'https:\\example.com' },
    { snapshotId: '0' },
    { snapshotId: '23extra' },
    { snapshotId: 'Infinity' },
    { snapshotId: '2147483648' },
    { commitShas: '' },
    { commitShas: 'shortsha' },
    { commitShas: [sha, sha.toUpperCase()] },
    { reviewedAt: 'not a date' },
    { reviewedAt: '2026-10-18T12:00' },
    { reviewedAt: '2026-02-30T12:00:00Z' },
    { intent: 'unknown' },
    { intent: 'revoke-approval' },
  ])('rejects invalid input %j without storage or snapshot refresh', async (fields) => {
    const result = await action(args({ ...valid, ...fields }))
    expect(result).toMatchObject({ error: expect.any(String) })
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each(['forbidden', 'not_found', 'stale_ground', 'incomplete_evidence', 'invalid_approval'] as const)(
    'shows %s from registration without creating replacement evidence',
    async (code) => {
      mocks.register.mockRejectedValue(new RepositoryApprovalError(code, 'Server validation rejected'))
      const result = await action(args())
      expect(result).toMatchObject({ error: expect.any(String), stale: code === 'stale_ground' })
      expect(mocks.start).not.toHaveBeenCalled()
    },
  )

  it('handles an incomplete interval when starting review', async () => {
    mocks.start.mockRejectedValue(new RepositoryApprovalError('incomplete_evidence', 'Missing comparison'))
    expect(await action(args({ intent: 'start-review' }))).toMatchObject({
      error: expect.stringContaining('ufullstendig'),
    })
  })

  it('explains when a selected commit is outside the frozen snapshot', async () => {
    mocks.register.mockRejectedValue(new RepositoryApprovalError('commit_outside_snapshot', 'Not in snapshot'))
    expect(await action(args())).toMatchObject({
      error:
        'En valgt commit finnes ikke i det fryste vurderingsgrunnlaget. Velg bare commits fra denne gjennomgangen.',
      stale: false,
    })
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each([
    { origin: 'https://attacker.example' },
    { origin: 'null' },
    { site: 'cross-site' },
    { method: 'GET' },
    { method: 'PUT' },
  ])('rejects cross-origin or non-POST requests %j', async (options) => {
    expect(await action(args(valid, options))).toMatchObject({ error: expect.any(String) })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('rejects requests without Origin rather than treating them as trusted', async () => {
    const input = args() as { request: Request }
    input.request.headers.delete('Origin')
    expect(await action(input as never)).toMatchObject({ error: expect.any(String) })
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', '17x', 'NaN', '2147483648'])('rejects invalid delivery %s', async (deliveryId) => {
    await expect(action(args(valid, { deliveryId }))).rejects.toMatchObject({ status: 400 })
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it.each(['0', 'Infinity', '5extra', '6'])('rejects invalid or mismatched repository %s', async (repositoryId) => {
    await expect(action(args(valid, { repositoryId }))).rejects.toMatchObject({ status: 400 })
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('propagates unexpected errors rather than falsely reporting success', async () => {
    mocks.register.mockRejectedValue(new Error('Connection failed'))
    await expect(action(args())).rejects.toThrow('Connection failed')
  })
})

describe('repository approval revocation action', () => {
  const fields = { intent: 'revoke-approval', approvalId: '41', reason: ' Feil grunnlag. ' }
  it('revokes with authenticated identity and a trimmed reason', async () => {
    expect(await revoke(args(fields))).toMatchObject({ success: expect.any(String) })
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith(user, 5, 17, 41, 'Feil grunnlag.')
    expect(mocks.repository).toHaveBeenCalledWith('navikt', 'glad-fjord', expect.any(URL), '/admin/code-deliveries/17')
  })
  it('does not report success for boolean no-op', async () => {
    mocks.revoke.mockResolvedValue(false)
    expect(await revoke(args(fields))).toEqual({ error: expect.stringContaining('allerede tilbakekalt') })
  })
  it.each([{ reason: '' }, { reason: ' ' }, { approvalId: '-1' }, { approvalId: '4x' }, { intent: 'start-review' }])(
    'rejects %j',
    async (invalid) => {
      expect(await revoke(args({ ...fields, ...invalid }))).toMatchObject({ error: expect.any(String) })
      expect(mocks.revoke).not.toHaveBeenCalled()
    },
  )
  it.each(['forbidden', 'not_found', 'invalid_approval'] as const)('handles %s', async (code) => {
    mocks.revoke.mockRejectedValue(new RepositoryApprovalError(code, 'Rejected'))
    expect(await revoke(args(fields))).toMatchObject({ error: expect.any(String) })
  })
  it('enforces same-origin for revocation too', async () => {
    expect(await revoke(args(fields, { origin: 'https://attacker.example' }))).toMatchObject({
      error: expect.any(String),
    })
    expect(mocks.revoke).not.toHaveBeenCalled()
  })
})
