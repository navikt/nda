/**
 * Integration tests for recordBaselineApproval().
 *
 * Verifies that:
 * - A row is inserted when no attributed baseline_approval exists (no history rows)
 * - A row is inserted when a baseline_approval row exists but changed_by IS NULL
 * - No row is inserted (returns false) when an attributed approver already exists
 * - Concurrent submissions are handled safely (ON CONFLICT DO NOTHING)
 */

import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { recordBaselineApproval } from '../../deployments/status-history.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

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

const IN_PERIOD = new Date('2026-03-10T10:00:00Z')

describe('recordBaselineApproval', () => {
  it('inserts a baseline_approval row and returns true when no attributed approver exists', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
    })

    const inserted = await recordBaselineApproval(deploymentId, 'Z990001')

    expect(inserted).toBe(true)

    const { rows } = await pool.query(
      `SELECT changed_by, change_source, from_status, to_status
       FROM deployment_status_history
       WHERE deployment_id = $1 AND change_source = 'baseline_approval'`,
      [deploymentId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].changed_by).toBe('Z990001')
    expect(rows[0].from_status).toBe('baseline')
    expect(rows[0].to_status).toBe('baseline')
  })

  it('inserts when an unattributed baseline_approval row exists (changed_by IS NULL)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-b',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
    })

    // Existing row with no approver — simulates historical data gap
    await pool.query(
      `INSERT INTO deployment_status_history (deployment_id, from_status, to_status, changed_by, change_source)
       VALUES ($1, 'pending_baseline', 'baseline', NULL, 'baseline_approval')`,
      [deploymentId],
    )

    const inserted = await recordBaselineApproval(deploymentId, 'Z990002')

    expect(inserted).toBe(true)

    const { rows } = await pool.query(
      `SELECT changed_by FROM deployment_status_history
       WHERE deployment_id = $1 AND change_source = 'baseline_approval' AND changed_by IS NOT NULL`,
      [deploymentId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].changed_by).toBe('Z990002')
  })

  it('returns false without inserting when an attributed approver already exists', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-c', appName: 'app-c', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-c',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
    })

    // First attribution
    await pool.query(
      `INSERT INTO deployment_status_history (deployment_id, from_status, to_status, changed_by, change_source)
       VALUES ($1, 'pending_baseline', 'baseline', 'Z990003', 'baseline_approval')`,
      [deploymentId],
    )

    const inserted = await recordBaselineApproval(deploymentId, 'Z990099')

    expect(inserted).toBe(false)

    // Original approver must be unchanged
    const { rows } = await pool.query(
      `SELECT changed_by FROM deployment_status_history
       WHERE deployment_id = $1 AND change_source = 'baseline_approval' AND changed_by IS NOT NULL`,
      [deploymentId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].changed_by).toBe('Z990003')
  })

  it('handles concurrent calls safely — second insert is silently ignored', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-d', appName: 'app-d', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-d',
      environment: 'prod-gcp',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'baseline',
    })

    // Simulate two concurrent requests racing
    const [first, second] = await Promise.all([
      recordBaselineApproval(deploymentId, 'Z990004'),
      recordBaselineApproval(deploymentId, 'Z990005'),
    ])

    // Exactly one should have inserted
    expect([first, second].filter(Boolean)).toHaveLength(1)

    const { rows } = await pool.query(
      `SELECT changed_by FROM deployment_status_history
       WHERE deployment_id = $1 AND change_source = 'baseline_approval' AND changed_by IS NOT NULL`,
      [deploymentId],
    )
    expect(rows).toHaveLength(1)
  })
})
