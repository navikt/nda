import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  claimRepositoryCodeDeliveryAssessmentSyncCandidates,
  deferRepositoryCodeDeliveryAssessmentSync,
  enqueueRepositoryCodeDeliveryAssessmentSync,
  getRepositoryCodeDeliveryAssessmentSyncProgress,
  markRepositoryCodeDeliveryAssessmentAssociationCompleted,
  markRepositoryCodeDeliveryAssessmentStackParentsCompleted,
  markRepositoryCodeDeliveryAssessmentSyncCompleted,
  markRepositoryCodeDeliveryAssessmentSyncFailed,
} from '../../repository-code-delivery-assessment-sync.server'
import { seedRepository, truncateAllTables } from './helpers'

const SHA_BASE = '1'.repeat(40)
const SHA_HEAD = '2'.repeat(40)

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

async function createDelivery(): Promise<number> {
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '900',
    githubOwner: 'navikt',
    githubRepoName: 'repo',
    defaultBranch: 'main',
  })
  await pool.query('UPDATE repositories SET code_delivery_tracking = true WHERE id = $1', [repositoryId])
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [repositoryId, SHA_BASE, SHA_HEAD],
  )
  return rows[0].id
}

describe('repository code delivery assessment sync queue', () => {
  it('retries with backoff, defers rate-limited work, and stops after the attempt limit', async () => {
    const deliveryId = await createDelivery()
    await enqueueRepositoryCodeDeliveryAssessmentSync(pool, deliveryId)

    expect(await claimRepositoryCodeDeliveryAssessmentSyncCandidates(1)).toEqual([
      expect.objectContaining({ deliveryId }),
    ])
    expect(await markRepositoryCodeDeliveryAssessmentSyncFailed(deliveryId, 'transient')).toBe(false)

    const retryState = await pool.query<{
      attempt_count: number
      failed_permanently: boolean
      last_error: string
      next_attempt_at: Date
    }>(
      `SELECT attempt_count, failed_permanently, last_error, next_attempt_at
       FROM repository_code_delivery_assessment_sync
       WHERE delivery_id = $1`,
      [deliveryId],
    )
    expect(retryState.rows[0]).toMatchObject({ attempt_count: 1, failed_permanently: false, last_error: 'transient' })
    expect(retryState.rows[0].next_attempt_at.getTime()).toBeGreaterThan(Date.now())

    await pool.query(
      `UPDATE repository_code_delivery_assessment_sync
       SET attempt_count = 11, next_attempt_at = now()
       WHERE delivery_id = $1`,
      [deliveryId],
    )
    expect(await claimRepositoryCodeDeliveryAssessmentSyncCandidates(1)).toEqual([
      expect.objectContaining({ deliveryId }),
    ])
    expect(await markRepositoryCodeDeliveryAssessmentSyncFailed(deliveryId, 'permanent')).toBe(true)

    await enqueueRepositoryCodeDeliveryAssessmentSync(pool, deliveryId)
    const resetState = await pool.query<{ attempt_count: number; failed_permanently: boolean }>(
      `SELECT attempt_count, failed_permanently
       FROM repository_code_delivery_assessment_sync
       WHERE delivery_id = $1`,
      [deliveryId],
    )
    expect(resetState.rows[0]).toEqual({ attempt_count: 0, failed_permanently: false })

    expect(await claimRepositoryCodeDeliveryAssessmentSyncCandidates(1)).toEqual([
      expect.objectContaining({ deliveryId }),
    ])
    await deferRepositoryCodeDeliveryAssessmentSync(deliveryId, 'rate limit')
    const deferredState = await pool.query<{ attempt_count: number; locked_until: Date | null; last_error: string }>(
      `SELECT attempt_count, locked_until, last_error
       FROM repository_code_delivery_assessment_sync
       WHERE delivery_id = $1`,
      [deliveryId],
    )
    expect(deferredState.rows[0]).toMatchObject({ attempt_count: 0, locked_until: null, last_error: 'rate limit' })

    await pool.query(
      `UPDATE repository_code_delivery_assessment_sync
       SET next_attempt_at = now()
       WHERE delivery_id = $1`,
      [deliveryId],
    )
    await claimRepositoryCodeDeliveryAssessmentSyncCandidates(1)
    await markRepositoryCodeDeliveryAssessmentSyncCompleted(deliveryId)
    const completedState = await pool.query<{ completed_at: Date | null }>(
      'SELECT completed_at FROM repository_code_delivery_assessment_sync WHERE delivery_id = $1',
      [deliveryId],
    )
    expect(completedState.rows[0].completed_at).not.toBeNull()
    expect(await claimRepositoryCodeDeliveryAssessmentSyncCandidates(1)).toEqual([])
  })

  it('reconciles old-pod deliveries and keeps per-delivery progress across rate-limit deferrals', async () => {
    const deliveryId = await createDelivery()
    const repositoryId = await pool.query<{ repository_id: number }>(
      'SELECT repository_id FROM repository_code_deliveries WHERE id = $1',
      [deliveryId],
    )
    await pool.query("UPDATE repositories SET code_delivery_tracking_since = now() + interval '1 day' WHERE id = $1", [
      repositoryId.rows[0].repository_id,
    ])

    expect(await claimRepositoryCodeDeliveryAssessmentSyncCandidates(1)).toEqual([
      expect.objectContaining({ deliveryId }),
    ])

    const sha = '3'.repeat(40)
    await markRepositoryCodeDeliveryAssessmentAssociationCompleted(deliveryId, sha, 17)
    await markRepositoryCodeDeliveryAssessmentStackParentsCompleted(deliveryId, 17, [18, 19])
    await deferRepositoryCodeDeliveryAssessmentSync(deliveryId, 'rate limit')

    const progress = await getRepositoryCodeDeliveryAssessmentSyncProgress(deliveryId)
    expect(progress).toEqual({
      completedAssociationSnapshotIds: { [sha]: 17 },
      completedPullRequestSnapshotIds: {},
      stackParentPullRequestNumbers: { 17: [18, 19] },
    })
  })
})
