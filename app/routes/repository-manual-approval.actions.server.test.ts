import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  repository: vi.fn(),
  approve: vi.fn(),
  revoke: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({ requireUser: mocks.user }))
vi.mock('~/lib/repository-resolution.server', () => ({ resolveRepositoryFromParams: mocks.repository }))
vi.mock('~/db/repository-manual-approvals.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/db/repository-manual-approvals.server')>()),
  approveRepositoryDelivery: mocks.approve,
  revokeRepositoryManualApproval: mocks.revoke,
}))

import { RepositoryApprovalError } from '~/db/repository-manual-approvals.server'
import { action as revoke } from './repository.$owner.$repo.admin.code-deliveries.$deliveryId.actions.server'
import { action } from './repository.$owner.$repo.approvals.$deliveryId.actions.server'

const params = { owner: 'navikt', repo: 'glad-fjord', deliveryId: '17' }
const user = { navIdent: 'Z990003', role: 'user', isActualAdmin: false, adminSuppressed: true, entraGroups: [] }
const valid = { intent: 'approve-repository', previewToken: 'a'.repeat(64), note: ' Gjennomgått kode. ' }

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
  mocks.approve.mockResolvedValue({ approvalId: 41, commitShas: ['b'.repeat(40)] })
  mocks.revoke.mockResolvedValue(true)
})

describe('repository manual approval actions', () => {
  it('approves from the read-only preview with optional note and authenticated identity', async () => {
    const result = await action(args({ ...valid, reviewer: 'Z990001', registeredBy: 'Z990002' }))
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(user, 5, 17, {
      previewToken: 'a'.repeat(64),
      note: 'Gjennomgått kode.',
    })
    expect(result).toMatchObject({
      registered: true,
      success: expect.stringContaining('Deploymentstatus er ikke endret'),
    })
  })

  it('allows approval without a note', async () => {
    await action(args({ intent: 'approve-repository', previewToken: 'a'.repeat(64), note: '' }))
    expect(mocks.approve).toHaveBeenCalledWith(user, 5, 17, { previewToken: 'a'.repeat(64), note: null })
  })

  it('rejects comments longer than 5000 characters', async () => {
    expect(
      await action(args({ intent: 'approve-repository', previewToken: 'a'.repeat(64), note: 'a'.repeat(5001) })),
    ).toMatchObject({ error: expect.any(String) })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it.each([{ previewToken: '' }, { previewToken: 'bad-hash' }, { intent: 'register-approval' }])(
    'rejects invalid input %j',
    async (invalid) => {
      expect(await action(args({ ...valid, ...invalid }))).toMatchObject({ error: expect.any(String) })
      expect(mocks.approve).not.toHaveBeenCalled()
    },
  )

  it.each([
    'forbidden',
    'not_found',
    'stale_ground',
    'incomplete_evidence',
    'invalid_approval',
    'no_approvable_commits',
  ] as const)('shows %s from approval', async (code) => {
    mocks.approve.mockRejectedValue(new RepositoryApprovalError(code, 'Server validation rejected'))
    expect(await action(args())).toMatchObject({ error: expect.any(String), stale: code === 'stale_ground' })
  })

  it('explains when the evidence has changed since preview', async () => {
    mocks.approve.mockRejectedValue(new RepositoryApprovalError('stale_ground', 'Changed'))
    expect(await action(args())).toMatchObject({ error: expect.stringContaining('endret'), stale: true })
  })

  it.each([
    { origin: 'https://attacker.example' },
    { origin: 'null' },
    { site: 'cross-site' },
    { method: 'GET' },
    { method: 'PUT' },
  ])('rejects cross-origin or non-POST requests %j', async (options) => {
    expect(await action(args(valid, options))).toMatchObject({ error: expect.any(String) })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('rejects requests without Origin rather than treating them as trusted', async () => {
    const input = args() as { request: Request }
    input.request.headers.delete('Origin')
    expect(await action(input as never)).toMatchObject({ error: expect.any(String) })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', '17x', 'NaN', '2147483648'])('rejects invalid delivery %s', async (deliveryId) => {
    await expect(action(args(valid, { deliveryId }))).rejects.toMatchObject({ status: 400 })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it.each(['0', 'Infinity', '5extra', '6'])('rejects invalid or mismatched repository %s', async (repositoryId) => {
    await expect(action(args(valid, { repositoryId }))).rejects.toMatchObject({ status: 400 })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('propagates unexpected errors rather than falsely reporting success', async () => {
    mocks.approve.mockRejectedValue(new Error('Connection failed'))
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
  it.each([
    { reason: '' },
    { reason: ' ' },
    { approvalId: '-1' },
    { approvalId: '4x' },
    { intent: 'approve-repository' },
  ])('rejects %j', async (invalid) => {
    expect(await revoke(args({ ...fields, ...invalid }))).toMatchObject({ error: expect.any(String) })
    expect(mocks.revoke).not.toHaveBeenCalled()
  })
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
