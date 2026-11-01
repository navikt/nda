import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAssessments, query } = vi.hoisted(() => ({ getAssessments: vi.fn(), query: vi.fn() }))
vi.mock('../repository-delivery-assessments.server', () => ({
  getStoredRepositoryDeliveryAssessments: getAssessments,
}))

import { getRepositoryAssessmentDiagnostic } from '../repository-assessment-diagnostic.server'

const delivery = { id: 153, base_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40) }
const reference = (id: number) => ({ id, fetchedAt: '2026-10-31T19:00:00.000Z' })
const interval = {
  state: 'complete',
  comparisonComplete: true,
  totalCommits: 1,
  commits: [{ sha: delivery.head_sha, authorLogin: 'dependabot[bot]', reason: 'approval_before_last_commit' }],
}
const approval = {
  status: 'incomplete',
  commits: [{ sha: delivery.head_sha, reason: 'unknown_commit_author' }],
}
const evaluationInput = { implicitApprovalMode: 'off', defaultBranch: 'main', pullRequestsByNumber: { 264: null } }

describe('repository assessment diagnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAssessments.mockResolvedValue({
      assessments: new Map([
        [
          153,
          {
            interval,
            assessment: approval,
            evidence: evaluationInput,
            sources: {
              comparisons: [reference(11)],
              associations: [reference(12)],
              pullRequests: [reference(13), reference(14), reference(15)],
              stackComparisons: [reference(16)],
            },
            manualApprovals: [],
          },
        ],
      ]),
      lookups: new Map(),
    })
    query.mockImplementation(async (sql: string, params: [string | number, number[]]) => {
      if (sql.includes('repository_code_delivery_assessment_sync')) {
        return { rows: [{ delivery_id: 153, state: { completed_at: null, last_error: 'retry', attempt_count: 2 } }] }
      }
      return { rows: params[1].map((id) => ({ id, snapshot: { id, data: { raw: id } } })) }
    })
  })

  it('exports both evaluations and their exact raw references on the caller connection', async () => {
    const result = await getRepositoryAssessmentDiagnostic({ query }, 216, '1045406252', [delivery])
    expect(getAssessments).toHaveBeenCalledWith({ query }, 216, [delivery])
    expect(result[0]).toMatchObject({
      deliveryId: 153,
      intervalAssessment: interval,
      approvalAssessment: approval,
      evaluationInput,
      authorIdentities: [{ githubUsername: 'dependabot[bot]', activeNavIdent: null }],
      assessmentSync: { last_error: 'retry', attempt_count: 2 },
      snapshots: {
        comparisons: [{ id: 11, data: { raw: 11 } }],
        associations: [{ id: 12 }],
        pullRequests: [{ id: 13 }, { id: 14 }, { id: 15 }],
        stackComparisons: [{ id: 16 }],
      },
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('github_compare_raw_snapshots'), [
      '1045406252',
      [11, 16],
    ])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('github_pr_raw_snapshots'), ['1045406252', [13, 14, 15]])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('delivery.repository_id = $1'), [216, [153]])
  })

  it('represents an absent sync record explicitly and rejects missing referenced raw snapshots', async () => {
    query.mockResolvedValue({ rows: [] })
    getAssessments.mockResolvedValue({
      assessments: new Map([
        [
          153,
          {
            interval,
            assessment: approval,
            evidence: evaluationInput,
            manualApprovals: [],
            sources: { comparisons: [], associations: [], pullRequests: [], stackComparisons: [] },
          },
        ],
      ]),
      lookups: new Map(),
    })
    expect(
      (await getRepositoryAssessmentDiagnostic({ query }, 216, '1045406252', [delivery]))[0].assessmentSync,
    ).toBeNull()
    getAssessments.mockResolvedValue({
      assessments: new Map([
        [
          153,
          {
            interval,
            assessment: approval,
            evidence: evaluationInput,
            manualApprovals: [],
            sources: { comparisons: [reference(11)], associations: [], pullRequests: [], stackComparisons: [] },
          },
        ],
      ]),
      lookups: new Map(),
    })
    await expect(getRepositoryAssessmentDiagnostic({ query }, 216, '1045406252', [delivery])).rejects.toThrow(
      'Missing referenced diagnostic snapshot 11',
    )
  })

  it('does not read evidence when no registered deliveries are included', async () => {
    expect(await getRepositoryAssessmentDiagnostic({ query }, 216, '1045406252', [])).toEqual([])
    expect(getAssessments).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })
})
