import { beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery, connect, withTransaction, assessmentDiagnostic } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  connect: vi.fn(),
  withTransaction: vi.fn(),
  assessmentDiagnostic: vi.fn(),
}))

vi.mock('../connection.server', () => ({
  pool: { query: poolQuery, connect },
  withTransaction,
}))
vi.mock('../repository-code-delivery-assessment-sync.server', () => ({
  REPOSITORY_CODE_DELIVERY_ASSESSMENT_VERSION: 1,
}))
vi.mock('../repository-code-delivery-interval-assessment.server', () => ({
  getRepositoryCodeDeliveryIntervalAssessments: vi.fn(),
}))
vi.mock('../repository-assessment-diagnostic.server', () => ({
  getRepositoryAssessmentDiagnostic: assessmentDiagnostic,
}))

import {
  getRepositoryApprovalComparisonExport,
  getRepositoryCodeDeliveryOverview,
  getRepositoryHistoryReadiness,
  listOpenUnresolvedCodeDeployments,
} from '../repository-code-delivery-overview.server'

describe('repository delivery overview transaction client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockRejectedValue(new Error('Unexpected pool query'))
    withTransaction.mockRejectedValue(new Error('Unexpected nested transaction'))
  })

  it('reads overview counts on the supplied connection without accessing the pool', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ count: 3 }] })
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: 2 }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    expect(await getRepositoryCodeDeliveryOverview(5, client)).toEqual({
      deliveryCount: 3,
      linkedDeploymentCount: 5,
      awaitingDeploymentCount: 2,
      unresolvedByReason: {},
    })
    expect(poolQuery).not.toHaveBeenCalled()
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('reads history readiness without opening a nested transaction', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ deployment_count: 5, deployments_missing_sha: 1, deployments_without_known_app_link: 2 }],
        }),
    }
    expect(await getRepositoryHistoryReadiness(5, client)).toEqual({
      applications: [],
      repositoryDeploymentCount: 5,
      repositoryDeploymentsMissingShaCount: 1,
      repositoryDeploymentsWithoutKnownAppLinkCount: 2,
    })
    expect(poolQuery).not.toHaveBeenCalled()
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('reads unresolved deployments on the supplied connection without accessing the pool', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect(await listOpenUnresolvedCodeDeployments(5, 100, client)).toEqual([])
    expect(client.query).toHaveBeenCalledWith(expect.any(String), [5, 100])
    expect(poolQuery).not.toHaveBeenCalled()
  })
})

function exportClient() {
  const deliveries = Array.from({ length: 205 }, (_, index) => ({
    id: index + 1,
    base_sha: 'base',
    head_sha: 'head',
  }))
  let cursorSql = ''
  let offset = 0
  const release = vi.fn()
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('transaction_timestamp() AS exported_at')) {
      return { rows: [{ id: 5, github_repo_id: '123', exported_at: new Date('2026-11-03T00:00:00Z') }] }
    }
    if (sql.includes('AS deployments_without_known_app_link')) {
      return { rows: [{ deployment_count: 2, deployments_missing_sha: 0, deployments_without_known_app_link: 0 }] }
    }
    if (sql.startsWith('DECLARE')) {
      cursorSql = sql
      offset = 0
    }
    if (sql.startsWith('FETCH')) {
      let rows: Record<string, unknown>[] = []
      if (cursorSql.includes('SELECT id, base_sha')) rows = deliveries
      else if (cursorSql.includes('AS "applicationStatus"'))
        rows = [
          { deploymentId: 1, deliveryId: 1, applicationStatus: 'manually_approved' },
          { deploymentId: 2, deliveryId: null, applicationStatus: 'verified_via_sibling' },
        ]
      else if (cursorSql.includes('to_jsonb(dc)'))
        rows = [{ deployment_id: 1, approval: { approved_by: 'Z990001', deleted_at: '2026-10-01' } }]
      else if (cursorSql.includes('FROM verification_runs vr'))
        rows = [{ deployment_id: 2, result: { sourceDeploymentId: 1 } }]
      else if (cursorSql.includes('SELECT d.id FROM deployments')) rows = [{ id: 1 }, { id: 2 }]
      const batch = rows.slice(offset, offset + 100)
      offset += 100
      return { rows: batch }
    }
    if (sql.includes('d.id AS deployment_id, d.nais_deployment_id')) {
      return {
        rows: [
          { deployment_id: 1, delivery_id: 1 },
          { deployment_id: 2, delivery_id: null },
        ],
      }
    }
    return { rows: [] }
  })
  const client = { query, release }
  connect.mockResolvedValue(client)
  assessmentDiagnostic.mockImplementation(async (_client, _repositoryId, _githubRepoId, rows) =>
    rows.map((row: { id: number }) => ({ deliveryId: row.id, approvalAssessment: { status: 'not_approved' } })),
  )
  return client
}

describe('streamed approval comparison', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits one complete JSON document with bounded assessment batches and historical evidence', async () => {
    const client = exportClient()
    let json = ''
    for await (const chunk of getRepositoryApprovalComparisonExport(5)) json += chunk
    const data = JSON.parse(json)
    expect(data.deliveries).toHaveLength(205)
    expect(data.repositoryAssessments).toHaveLength(205)
    expect(assessmentDiagnostic.mock.calls.map((call) => call[3].length)).toEqual([100, 100, 5])
    expect(data.comparison).toEqual([
      { deploymentId: 1, deliveryId: 1, applicationStatus: 'manually_approved', repositoryCodeStatus: 'not_approved' },
      {
        deploymentId: 2,
        deliveryId: null,
        applicationStatus: 'verified_via_sibling',
        repositoryCodeStatus: 'missing_link',
      },
    ])
    expect(data.applicationManualApprovals[0].approval.deleted_at).toBe('2026-10-01')
    expect(data.verificationRuns[0].result.sourceDeploymentId).toBe(1)
    expect(client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back and releases the snapshot when consumption is cancelled', async () => {
    const client = exportClient()
    const chunks = getRepositoryApprovalComparisonExport(5)
    await chunks.next()
    expect(assessmentDiagnostic).not.toHaveBeenCalled()
    await chunks.return(undefined)
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('does not emit a complete JSON document when an assessment is missing', async () => {
    const client = exportClient()
    assessmentDiagnostic.mockResolvedValue([])
    const chunks = getRepositoryApprovalComparisonExport(5)
    await expect(async () => {
      for await (const _chunk of chunks) {
      }
    }).rejects.toThrow('Missing repository assessment for delivery 1')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })
})
