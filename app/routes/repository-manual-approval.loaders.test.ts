import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  repository: vi.fn(),
  page: vi.fn(),
  deliveries: vi.fn(),
  start: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({ requireUser: mocks.user }))
vi.mock('~/lib/repository-resolution.server', () => ({ resolveRepositoryFromParams: mocks.repository }))
vi.mock('~/db/repository-manual-approvals.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/db/repository-manual-approvals.server')>()),
  getRepositoryApprovalPage: mocks.page,
  getRepositoryApprovalDeliveries: mocks.deliveries,
  createRepositoryApprovalReview: mocks.start,
}))

import { RepositoryApprovalError } from '~/db/repository-manual-approvals.server'
import { loader as loadList } from './repository.$owner.$repo.approvals'
import RepositoryApprovalRoute, { loader as loadPage } from './repository.$owner.$repo.approvals.$deliveryId'

const params = { owner: 'navikt', repo: 'glad-fjord', deliveryId: '17' }
const user = { navIdent: 'Z990003', role: 'user', isActualAdmin: false }

function args(search = '?repositoryId=5', deliveryId = '17') {
  return {
    params: { ...params, deliveryId },
    request: new Request(`http://localhost/repository/navikt/glad-fjord/approvals/17${search}`),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue(user)
  mocks.repository.mockResolvedValue({
    id: 5,
    github_owner: 'navikt',
    github_repo_name: 'glad-fjord',
    audit_start_year: 2020,
    implicit_approval_mode: 'off',
  })
  mocks.page.mockResolvedValue({
    delivery: { id: 17, base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), first_deployed_at: null },
    manualApprovalHistory: [],
  })
  mocks.deliveries.mockResolvedValue({ deliveries: [], page: 1, hasNextPage: false })
})

describe('scoped approval loaders', () => {
  it('loads the approver page without admin gating, creating snapshots or returning repository settings', async () => {
    const result = await loadPage(args())
    expect(mocks.page).toHaveBeenCalledExactlyOnceWith(user, 5, 17)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(result.repository).toEqual({ id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' })
    expect(result.manualApprovalHistory).toEqual([])
    expect(result).not.toHaveProperty('affectedApps')
    expect(result).not.toHaveProperty('user')
  })

  it('resets fetcher review state when navigating to a different repository or delivery', async () => {
    const page = await loadPage(args())
    const first = RepositoryApprovalRoute({ loaderData: page } as never)
    const other = RepositoryApprovalRoute({ loaderData: { ...page, delivery: { ...page.delivery, id: 18 } } } as never)
    const otherRepository = RepositoryApprovalRoute({
      loaderData: { ...page, repository: { ...page.repository, id: 6 } },
    } as never)
    expect(first.key).toBe('5:17')
    expect(other.key).toBe('5:18')
    expect(otherRepository.key).toBe('6:17')
  })

  it.each(['forbidden', 'not_found'] as const)('handles %s from scoped read', async (code) => {
    mocks.page.mockRejectedValue(new RepositoryApprovalError(code, 'Rejected'))
    await expect(loadPage(args())).rejects.toMatchObject({ status: code === 'forbidden' ? 403 : 404 })
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', 'NaN', '17x', '2147483648'])(
    'rejects invalid delivery ID %s before reading approval data',
    async (id) => {
      await expect(loadPage(args('?repositoryId=5', id))).rejects.toMatchObject({ status: 400 })
      expect(mocks.page).not.toHaveBeenCalled()
    },
  )

  it.each(['0', '-1', 'Infinity', '5x', '2147483648', '6'])('rejects invalid repository scope %s', async (id) => {
    await expect(loadPage(args(`?repositoryId=${id}`))).rejects.toMatchObject({ status: 400 })
    expect(mocks.page).not.toHaveBeenCalled()
  })

  it('loads a bounded delivery list for the authenticated approver', async () => {
    const result = await loadList(args('?repositoryId=5&page=2'))
    expect(mocks.deliveries).toHaveBeenCalledExactlyOnceWith(user, 5, 2)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(result.repository).not.toHaveProperty('audit_start_year')
    expect(mocks.repository).toHaveBeenCalledWith('navikt', 'glad-fjord', expect.any(URL), '/approvals')
  })

  it.each(['0', '-1', 'NaN', '1x', '2147483648'])('rejects invalid list page %s', async (page) => {
    await expect(loadList(args(`?repositoryId=5&page=${page}`))).rejects.toMatchObject({ status: 400 })
    expect(mocks.deliveries).not.toHaveBeenCalled()
  })

  it('denies the list for historical-only admins without approval rights', async () => {
    mocks.deliveries.mockRejectedValue(new RepositoryApprovalError('forbidden', 'Approval access required'))
    await expect(loadList(args())).rejects.toMatchObject({ status: 403 })
  })
})
