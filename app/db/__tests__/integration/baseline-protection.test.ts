import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PROTECTED_STATUSES_SQL } from '~/lib/four-eyes-status'
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

describe('baseline protection from re-verification overwrite', () => {
  it('should NOT overwrite baseline status via UPDATE', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-base', appName: 'app-base', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-base',
      environment: 'prod',
      fourEyesStatus: 'baseline',
      commitSha: 'abc123',
    })

    await pool.query(
      `UPDATE deployments
       SET four_eyes_status = $1
       WHERE id = $2
         AND four_eyes_status NOT IN (${PROTECTED_STATUSES_SQL})`,
      ['pending_baseline', depId],
    )

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [depId])
    expect(rows[0].four_eyes_status).toBe('baseline')
  })

  it('should NOT overwrite manually_approved status via UPDATE', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-manual', appName: 'app-manual', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-manual',
      environment: 'prod',
      fourEyesStatus: 'manually_approved',
      commitSha: 'def456',
    })

    await pool.query(
      `UPDATE deployments
       SET four_eyes_status = $1
       WHERE id = $2
         AND four_eyes_status NOT IN (${PROTECTED_STATUSES_SQL})`,
      ['unverified_commits', depId],
    )

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [depId])
    expect(rows[0].four_eyes_status).toBe('manually_approved')
  })

  it('should NOT overwrite legacy status via UPDATE', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-legacy', appName: 'app-legacy', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-legacy',
      environment: 'prod',
      fourEyesStatus: 'legacy',
      commitSha: 'ghi789',
    })

    await pool.query(
      `UPDATE deployments
       SET four_eyes_status = $1
       WHERE id = $2
         AND four_eyes_status NOT IN (${PROTECTED_STATUSES_SQL})`,
      ['pending', depId],
    )

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [depId])
    expect(rows[0].four_eyes_status).toBe('legacy')
  })

  it('should overwrite pending_baseline status (not protected)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-pb', appName: 'app-pb', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-pb',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
      commitSha: 'jkl012',
    })

    await pool.query(
      `UPDATE deployments
       SET four_eyes_status = $1
       WHERE id = $2
         AND four_eyes_status NOT IN (${PROTECTED_STATUSES_SQL})`,
      ['approved_pr', depId],
    )

    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [depId])
    expect(rows[0].four_eyes_status).toBe('approved_pr')
  })
})
