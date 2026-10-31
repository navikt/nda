import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserIdentity } from '~/lib/auth.server'
import type { RepositoryDeliveryIntervalAssessment } from '~/lib/repository-code-delivery/interval-assessment'
import type { UnresolvedReason } from '../repository-code-delivery-establishment.server'

const { query, getDelivery, getIntervals, getHistory, getLookups, capabilities } = vi.hoisted(() => ({
  query: vi.fn(),
  getDelivery: vi.fn(),
  getIntervals: vi.fn(),
  getHistory: vi.fn(),
  getLookups: vi.fn(),
  capabilities: vi.fn(),
}))
vi.mock('../connection.server', () => ({
  withTransaction: (read: (client: { query: typeof query }) => Promise<unknown>) => read({ query }),
}))
vi.mock('../repository-code-deliveries.server', () => ({ getRepositoryCodeDelivery: getDelivery }))
vi.mock('../repository-code-delivery-interval-assessment.server', () => ({
  getRepositoryCodeDeliveryIntervalAssessments: getIntervals,
}))
vi.mock('../repository-manual-approval-commits.server', () => ({ getRepositoryManualApprovalCommits: getHistory }))
vi.mock('../user-github-lookups.server', () => ({ getGithubUserLookups: getLookups }))
vi.mock('~/lib/authorization.server', () => ({ resolveRepositoryApprovalCapabilities: capabilities }))

import { getDeploymentRepositoryView } from '../deployment-repository-view.server'

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const context = {
  id: 42,
  monitored_app_id: 3,
  team_slug: 'team-fjord',
  environment_name: 'prod-gcp',
  app_name: 'glad-fjord-api',
  created_at: new Date('2026-10-20T10:00:00Z'),
  commit_sha: headSha,
  branch_name: 'main',
  deployer_username: 'rask-elv',
  four_eyes_status: 'unverified_commits',
  repository_id: 5,
  repository_code_delivery_id: 7,
  github_owner: 'navikt',
  github_repo_name: 'glad-fjord',
  code_delivery_tracking: true,
  code_delivery_tracking_since: new Date('2026-10-01T00:00:00Z'),
  unresolved_reason: null,
  verification_run_at: new Date('2026-10-20T10:01:00Z'),
  verification_base_sha: 'c'.repeat(40),
  verification_head_sha: headSha,
}
const interval: RepositoryDeliveryIntervalAssessment = {
  state: 'complete',
  comparisonComplete: true,
  defaultBranch: 'main',
  totalCommits: 1,
  listedCommits: 1,
  omittedCommits: 0,
  summary: { covered: 0, notCovered: 1, unknown: 0 },
  commits: [
    {
      sha: headSha,
      message: 'Skal ikke returneres til klienten',
      authorLogin: 'glad-fjord',
      authorUsername: 'glad-fjord',
      htmlUrl: '',
      pullRequestNumber: null,
      status: 'not_covered',
      reason: 'no_associated_pull_request',
    },
  ],
}

type LinkPatch = {
  repository_code_delivery_id?: number | null
  repository_id?: number | null
  commit_sha?: string | null
  unresolved_reason?: UnresolvedReason | null
}

function setContext(patch: Omit<Partial<typeof context>, keyof LinkPatch> & LinkPatch = {}) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('count(*) OVER')) {
      return {
        rows: [
          {
            id: 42,
            teamSlug: 'team-fjord',
            environmentName: 'prod-gcp',
            appName: 'glad-fjord-api',
            createdAt: context.created_at,
            total: 1,
          },
        ],
      }
    }
    if (sql.includes('FROM deployments d')) return { rows: [{ ...context, ...patch }] }
    return { rows: [] }
  })
}

describe('deployment repository comparison read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setContext()
    getDelivery.mockResolvedValue({ id: 7, repository_id: 5, base_sha: baseSha, head_sha: headSha })
    getIntervals.mockResolvedValue([{ deliveryId: 7, assessment: interval }])
    getHistory.mockResolvedValue([])
    getLookups.mockResolvedValue(
      new Map([['glad-fjord', { nav_ident: 'Z990001', active_nav_ident: 'Z990001', account_deleted_at: null }]]),
    )
    capabilities.mockResolvedValue({ canApprove: true })
  })

  it('uses the stored link and shared approval evaluator without losing the distinct application range', async () => {
    const data = await getDeploymentRepositoryView(42, null, 3)
    expect(data).toMatchObject({
      application: { range: { baseSha: 'c'.repeat(40), headSha } },
      link: {
        state: 'linked',
        delivery: { id: 7, baseSha, headSha },
        assessment: { status: 'not_approved' },
        canApprove: false,
      },
    })
    expect(getDelivery).toHaveBeenCalledWith(5, headSha, { query })
    expect(getIntervals).toHaveBeenCalledWith(5, [expect.objectContaining({ id: 7 })], { query })
    expect(getHistory).toHaveBeenCalledWith({ query }, 5, [7])
    expect(getLookups).toHaveBeenCalledWith(['rask-elv', 'glad-fjord'], { query })
    expect(capabilities).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('d.monitored_app_id = $2'), [42, 3])
    expect(query.mock.calls.map(([sql]) => sql).join('\n')).not.toContain('nais_apply_enabled')
    expect(JSON.stringify(data)).not.toContain('Skal ikke returneres')
  })

  it('includes only current eligible manual coverage and resolves approval capability on the same client', async () => {
    getHistory.mockResolvedValue([
      {
        sha: headSha,
        delivery_id: 7,
        status: 'eligible',
        author_login: 'glad-fjord',
        author_nav_ident: 'Z990001',
        reviewer_nav_ident: 'Z990002',
      },
    ])
    const actor = { navIdent: 'Z990002' } as UserIdentity
    const data = await getDeploymentRepositoryView(42, actor, 3)
    expect(data?.link).toMatchObject({ state: 'linked', assessment: { status: 'approved' }, canApprove: true })
    expect(capabilities).toHaveBeenCalledWith(actor, 5, { query })
    getHistory.mockResolvedValue([
      {
        sha: headSha,
        delivery_id: 7,
        status: 'revoked',
        author_login: 'glad-fjord',
        author_nav_ident: 'Z990001',
        reviewer_nav_ident: 'Z990002',
      },
    ])
    expect((await getDeploymentRepositoryView(42, actor, 3))?.link).toMatchObject({
      assessment: { status: 'not_approved' },
    })
  })

  it('shows an unlinked exact match as a candidate, never as coverage', async () => {
    setContext({ repository_code_delivery_id: null })
    expect((await getDeploymentRepositoryView(42, null, 3))?.link).toEqual({
      state: 'missing',
      reason: 'unlinked',
      unresolvedReason: null,
      candidate: { id: 7, baseSha, headSha },
    })
    expect(getIntervals).not.toHaveBeenCalled()
    expect(getHistory).not.toHaveBeenCalled()
  })

  it.each([
    [{ repository_id: null }, 'missing_repository'],
    [{ commit_sha: null }, 'missing_commit_sha'],
    [{ code_delivery_tracking: false }, 'tracking_disabled'],
    [{ created_at: new Date('2026-09-01T00:00:00Z') }, 'before_tracking'],
  ])('explains missing linkage without inventing a delivery: %s', async (patch, reason) => {
    setContext({ ...patch, repository_code_delivery_id: null })
    getDelivery.mockResolvedValue(null)
    expect((await getDeploymentRepositoryView(42, null, 3))?.link).toMatchObject({ state: 'missing', reason })
    expect(getIntervals).not.toHaveBeenCalled()
  })

  it('rejects inconsistent links rather than falling back to a matching SHA', async () => {
    getDelivery.mockResolvedValue({ id: 8, repository_id: 5, base_sha: baseSha, head_sha: headSha })
    await expect(getDeploymentRepositoryView(42, null, 3)).rejects.toThrow('inconsistent')
    expect(getIntervals).not.toHaveBeenCalled()
  })

  it('preserves the stored unresolved reason instead of assuming the sync is pending', async () => {
    setContext({ repository_code_delivery_id: null, unresolved_reason: 'ancestry_behind' })
    expect((await getDeploymentRepositoryView(42, null, 3))?.link).toMatchObject({
      state: 'missing',
      reason: 'unresolved',
      unresolvedReason: 'ancestry_behind',
    })
  })

  it('keeps incomplete evidence unknown, even when the application has a status', async () => {
    getIntervals.mockResolvedValue([
      {
        deliveryId: 7,
        assessment: { ...interval, comparisonComplete: false, totalCommits: null, commits: [], listedCommits: 0 },
      },
    ])
    expect((await getDeploymentRepositoryView(42, null, 3))?.link).toMatchObject({
      state: 'linked',
      assessment: { status: 'incomplete' },
    })
  })

  it('does not substitute an older or malformed application range', async () => {
    setContext({ verification_base_sha: 'invalid' })
    expect((await getDeploymentRepositoryView(42, null, 3))?.application.range).toBeNull()
  })

  it('returns no data when the deployment is absent from the requested app', async () => {
    query.mockResolvedValue({ rows: [] })
    expect(await getDeploymentRepositoryView(42, null, 999)).toBeNull()
    expect(getDelivery).not.toHaveBeenCalled()
  })
})
