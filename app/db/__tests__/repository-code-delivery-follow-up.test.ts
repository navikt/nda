import type { PoolClient } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepositoryDeliveryIntervalAssessment } from '~/lib/repository-code-delivery/interval-assessment'
import type { RepositoryCodeDeliverySummary } from '../repository-code-delivery-overview.server'

const { listDeliveries, getAssessments, getHistory, getLookups } = vi.hoisted(() => ({
  listDeliveries: vi.fn(),
  getAssessments: vi.fn(),
  getHistory: vi.fn(),
  getLookups: vi.fn(),
}))
vi.mock('../repository-code-delivery-overview.server', () => ({ listRepositoryCodeDeliveries: listDeliveries }))
vi.mock('../repository-code-delivery-interval-assessment.server', () => ({
  getRepositoryCodeDeliveryIntervalAssessments: getAssessments,
}))
vi.mock('../repository-manual-approval-commits.server', () => ({ getRepositoryManualApprovalCommits: getHistory }))
vi.mock('../user-github-lookups.server', () => ({ getGithubUserLookups: getLookups }))

import { getRepositoryCodeDeliveryFollowUp } from '../repository-code-delivery-follow-up.server'

const client = {} as PoolClient
const sha = 'b'.repeat(40)

function delivery(id: number): RepositoryCodeDeliverySummary {
  return {
    id,
    base_sha: 'a'.repeat(40),
    head_sha: sha,
    created_at: new Date('2026-10-20T12:00:00Z'),
    first_deployed_at: null,
    is_anchor: false,
    deployment_count: 1,
    app_names: ['glad-fjord'],
  }
}

function assessment(id: number, status: 'covered' | 'not_covered' | 'unknown' = 'not_covered') {
  const assessment: RepositoryDeliveryIntervalAssessment = {
    state: status === 'unknown' ? 'incomplete' : 'complete',
    comparisonComplete: true,
    defaultBranch: 'main',
    totalCommits: 1,
    listedCommits: 1,
    omittedCommits: 0,
    summary: {
      covered: status === 'covered' ? 1 : 0,
      notCovered: status === 'not_covered' ? 1 : 0,
      unknown: status === 'unknown' ? 1 : 0,
    },
    commits: [
      {
        sha,
        pullRequestNumber: null,
        status,
        reason: status === 'covered' ? 'approved_review' : 'no_associated_pull_request',
        message: 'Privat committekst',
        authorUsername: 'Glad Fjord',
        authorLogin: 'glad-fjord',
        htmlUrl: '',
      },
    ],
  }
  return { deliveryId: id, assessment, pullRequestNumbers: [42], evidence: { private: 'must not reach client' } }
}

describe('repository code delivery follow-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getLookups.mockResolvedValue(new Map([['glad-fjord', { account_deleted_at: null, active_nav_ident: 'Z990001' }]]))
    getHistory.mockResolvedValue([])
    getAssessments.mockImplementation(async (_id, batch: RepositoryCodeDeliverySummary[]) =>
      batch.map((item) => assessment(item.id)),
    )
  })

  it('filters across batches before paging and reports repository-wide counts', async () => {
    const deliveries = Array.from({ length: 125 }, (_, index) => delivery(125 - index))
    listDeliveries.mockResolvedValue(deliveries)
    getAssessments.mockImplementation(async (_id, batch: RepositoryCodeDeliverySummary[]) =>
      batch.map((item) => assessment(item.id, item.id > 22 ? 'covered' : 'not_covered')),
    )
    const sort = { orderBy: 'created_at' as const, direction: 'descending' as const }
    const result = await getRepositoryCodeDeliveryFollowUp(
      5,
      { page: 2, pageSize: 20, status: 'not_approved', sort },
      client,
    )

    expect(listDeliveries).toHaveBeenCalledWith(5, { limit: null, offset: 0, sort }, client)
    expect(getAssessments).toHaveBeenCalledTimes(2)
    expect(getHistory).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      counts: { approved: 103, not_approved: 22, incomplete: 0, no_changes: 0 },
      total: 22,
      page: 2,
      totalPages: 2,
    })
    expect(result.deliveries.map((item) => item.id)).toEqual([2, 1])
    expect(JSON.stringify(result)).not.toContain('Privat committekst')
    expect(JSON.stringify(result)).not.toContain('Z990001')
    expect(JSON.stringify(result)).not.toContain('must not reach client')
  })

  it('includes valid manual approvals but rejects revoked, changed-author and changed-identity approvals', async () => {
    listDeliveries.mockResolvedValue([1, 2, 3, 4].map(delivery))
    getHistory.mockResolvedValue(
      [1, 2, 3, 4].map((id) => ({
        delivery_id: id,
        sha,
        status: id === 2 ? 'revoked' : 'eligible',
        author_login: id === 3 ? 'stille-skog' : 'glad-fjord',
        author_nav_ident: id === 4 ? 'Z990003' : 'Z990001',
        reviewer_nav_ident: 'Z990002',
      })),
    )

    const result = await getRepositoryCodeDeliveryFollowUp(5, { page: 1, pageSize: 20, status: 'all' }, client)

    expect(result.counts).toEqual({ approved: 1, not_approved: 3, incomplete: 0, no_changes: 0 })
    expect(result.deliveries[0].followUp).toEqual({ status: 'approved', covered: 1, needsApproval: 0, unknown: 0 })
    expect(result.deliveries.slice(1).map((item) => item.followUp.status)).toEqual([
      'not_approved',
      'not_approved',
      'not_approved',
    ])
  })

  it('separates unknown PR evidence and missing identities from known missing approval', async () => {
    listDeliveries.mockResolvedValue([1, 2, 3].map(delivery))
    getLookups.mockResolvedValue(new Map())
    getAssessments.mockResolvedValue([assessment(1, 'unknown'), assessment(2), assessment(3, 'covered')])

    const result = await getRepositoryCodeDeliveryFollowUp(5, { page: 99, pageSize: 20, status: 'incomplete' }, client)

    expect(result).toMatchObject({
      page: 1,
      totalPages: 1,
      total: 2,
      counts: { incomplete: 2, not_approved: 0, approved: 1 },
    })
    expect(result.deliveries.map((item) => item.id)).toEqual([1, 2])
  })

  it('does not use a deleted account or user as a current identity', async () => {
    listDeliveries.mockResolvedValue([delivery(1)])
    getLookups.mockResolvedValue(
      new Map([['glad-fjord', { account_deleted_at: new Date(), active_nav_ident: 'Z990001' }]]),
    )
    expect(
      (await getRepositoryCodeDeliveryFollowUp(5, { page: 1, pageSize: 20, status: 'all' }, client)).counts.incomplete,
    ).toBe(1)
    getLookups.mockResolvedValue(new Map([['glad-fjord', { account_deleted_at: null, active_nav_ident: null }]]))
    expect(
      (await getRepositoryCodeDeliveryFollowUp(5, { page: 1, pageSize: 20, status: 'all' }, client)).counts.incomplete,
    ).toBe(1)
  })

  it('treats an anchor as no code changes even before compare evidence is available', async () => {
    listDeliveries.mockResolvedValue([{ ...delivery(1), base_sha: sha, is_anchor: true }])
    getAssessments.mockResolvedValue([
      {
        ...assessment(1),
        assessment: {
          ...assessment(1).assessment,
          state: 'unavailable',
          comparisonComplete: false,
          totalCommits: null,
          commits: [],
        },
      },
    ])
    const result = await getRepositoryCodeDeliveryFollowUp(5, { page: 1, pageSize: 20, status: 'all' }, client)
    expect(result.deliveries[0].followUp).toEqual({ status: 'no_changes', covered: 0, needsApproval: 0, unknown: 0 })
  })

  it('returns an empty first page for no matching deliveries and fails explicitly on missing assessments', async () => {
    listDeliveries.mockResolvedValue([delivery(1)])
    getAssessments.mockResolvedValue([assessment(1, 'covered')])
    expect(
      await getRepositoryCodeDeliveryFollowUp(5, { page: 99, pageSize: 20, status: 'not_approved' }, client),
    ).toMatchObject({ deliveries: [], total: 0, page: 1, totalPages: 1 })
    getAssessments.mockResolvedValue([])
    await expect(
      getRepositoryCodeDeliveryFollowUp(5, { page: 1, pageSize: 20, status: 'all' }, client),
    ).rejects.toThrow('Missing interval assessment for delivery 1')
  })
})
