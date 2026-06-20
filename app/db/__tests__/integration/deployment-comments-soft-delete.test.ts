import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createComment,
  deleteComment,
  deleteLegacyInfo,
  getCommentsByDeploymentId,
  getLegacyInfo,
  getManualApproval,
} from '../../comments.server'
import { truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterAll(async () => {
  await pool.end()
})

async function seedDeployment(pool: Pool, suffix: string): Promise<number> {
  const app = await pool.query<{ id: number }>(
    `INSERT INTO monitored_applications (team_slug, app_name, environment_name, is_active, audit_start_year, default_branch)
     VALUES ('t', $1, 'dev', true, 2025, 'main') RETURNING id`,
    [`a-${suffix}`],
  )
  const dep = await pool.query<{ id: number }>(
    `INSERT INTO deployments (
       monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name,
       commit_sha, created_at, four_eyes_status, deployer_username
     ) VALUES ($1, $2, 't', $3, 'dev', $4, NOW(), 'pending', 'deployer')
     RETURNING id`,
    [app.rows[0].id, `nd-${suffix}-${Date.now()}`, `a-${suffix}`, `sha-${suffix}`],
  )
  return dep.rows[0].id
}

describe('deployment_comments soft delete', () => {
  beforeEach(async () => {
    await truncateAllTables(pool)
  })

  it('deleteComment soft-deletes by setting deleted_at and deleted_by', async () => {
    const depId = await seedDeployment(pool, 'c1')
    const comment = await createComment({ deployment_id: depId, comment_text: 'hello', registered_by: 'Z990001' })

    const ok = await deleteComment(comment.id, 'Z990001', depId)
    expect(ok).toBe(true)

    const { rows } = await pool.query(
      'SELECT comment_text, deleted_at, deleted_by FROM deployment_comments WHERE id = $1',
      [comment.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].comment_text).toBe('hello')
    expect(rows[0].deleted_at).not.toBeNull()
    expect(rows[0].deleted_by).toBe('Z990001')
  })

  it('deleteComment is idempotent and returns false on second call', async () => {
    const depId = await seedDeployment(pool, 'c2')
    const comment = await createComment({ deployment_id: depId, comment_text: 'hi', registered_by: 'Z990001' })

    expect(await deleteComment(comment.id, 'Z990001', depId)).toBe(true)
    expect(await deleteComment(comment.id, 'Z990003', depId)).toBe(false)

    const { rows } = await pool.query('SELECT deleted_by FROM deployment_comments WHERE id = $1', [comment.id])
    expect(rows[0].deleted_by).toBe('Z990001')
  })

  it('deleteComment rejects wrong deploymentId (IDOR protection)', async () => {
    const depA = await seedDeployment(pool, 'idor-a')
    const depB = await seedDeployment(pool, 'idor-b')
    const comment = await createComment({ deployment_id: depA, comment_text: 'on dep A', registered_by: 'Z990001' })

    expect(await deleteComment(comment.id, 'Z990001', depB)).toBe(false)

    const { rows } = await pool.query('SELECT deleted_at FROM deployment_comments WHERE id = $1', [comment.id])
    expect(rows[0].deleted_at).toBeNull()
  })

  it('getCommentsByDeploymentId excludes soft-deleted comments', async () => {
    const depId = await seedDeployment(pool, 'c3')
    const kept = await createComment({ deployment_id: depId, comment_text: 'kept', registered_by: 'Z990001' })
    const removed = await createComment({ deployment_id: depId, comment_text: 'removed', registered_by: 'Z990001' })

    await deleteComment(removed.id, 'Z990001', depId)

    const comments = await getCommentsByDeploymentId(depId)
    expect(comments.map((c) => c.id)).toEqual([kept.id])
  })

  it('getManualApproval returns null when active approval is soft-deleted', async () => {
    const depId = await seedDeployment(pool, 'c4')
    const approval = await createComment({
      deployment_id: depId,
      comment_text: 'approved',
      comment_type: 'manual_approval',
      approved_by: 'Z990002',
      registered_by: 'Z990002',
    })

    expect((await getManualApproval(depId))?.id).toBe(approval.id)

    await deleteComment(approval.id, 'Z990001', depId)

    expect(await getManualApproval(depId)).toBeNull()
  })

  it('getLegacyInfo returns null when soft-deleted', async () => {
    const depId = await seedDeployment(pool, 'c5')
    await createComment({
      deployment_id: depId,
      comment_text: 'legacy',
      comment_type: 'legacy_info',
      registered_by: 'Z990002',
    })

    expect(await getLegacyInfo(depId)).not.toBeNull()

    expect(await deleteLegacyInfo(depId, 'Z990001')).toBe(true)

    expect(await getLegacyInfo(depId)).toBeNull()
  })

  it('deleteLegacyInfo soft-deletes only legacy_info comments, leaves others active', async () => {
    const depId = await seedDeployment(pool, 'c6')
    const free = await createComment({ deployment_id: depId, comment_text: 'free', registered_by: 'Z990001' })
    const legacy = await createComment({
      deployment_id: depId,
      comment_text: 'legacy',
      comment_type: 'legacy_info',
      registered_by: 'Z990001',
    })

    await deleteLegacyInfo(depId, 'Z990001')

    const { rows } = await pool.query<{ id: number; deleted_at: Date | null }>(
      'SELECT id, deleted_at FROM deployment_comments WHERE deployment_id = $1 ORDER BY id',
      [depId],
    )
    const byId = new Map(rows.map((r) => [r.id, r.deleted_at]))
    expect(byId.get(free.id)).toBeNull()
    expect(byId.get(legacy.id)).not.toBeNull()
  })

  it('deleteLegacyInfo is idempotent', async () => {
    const depId = await seedDeployment(pool, 'c7')
    await createComment({
      deployment_id: depId,
      comment_text: 'l',
      comment_type: 'legacy_info',
      registered_by: 'Z990001',
    })

    expect(await deleteLegacyInfo(depId, 'Z990001')).toBe(true)
    expect(await deleteLegacyInfo(depId, 'Z990003')).toBe(false)
  })

  it('soft-deleted row preserves audit fields (approved_by, registered_by)', async () => {
    const depId = await seedDeployment(pool, 'c8')
    const approval = await createComment({
      deployment_id: depId,
      comment_text: 'manual ok',
      comment_type: 'manual_approval',
      approved_by: 'Z990002',
      registered_by: 'Z990002',
    })

    await deleteComment(approval.id, 'Z990001', depId)

    const { rows } = await pool.query(
      'SELECT comment_text, approved_by, deleted_by FROM deployment_comments WHERE id = $1',
      [approval.id],
    )
    expect(rows[0].comment_text).toBe('manual ok')
    expect(rows[0].approved_by).toBe('Z990002')
    expect(rows[0].deleted_by).toBe('Z990001')
  })
})
