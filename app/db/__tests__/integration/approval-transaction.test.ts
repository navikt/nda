import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createComment } from '~/db/comments.server'
import { withTransaction } from '~/db/connection.server'
import { updateDeploymentFourEyes } from '~/db/deployments.server'
import { saveVerificationRun } from '~/db/github-data.server'
import { storeVerificationResult } from '~/lib/verification/store-data.server'
import type { VerificationResult } from '~/lib/verification/types'
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

describe('approval transaction', () => {
  function verificationResult(): VerificationResult {
    return {
      status: 'approved',
      hasFourEyes: true,
      deployedPr: null,
      unverifiedCommits: [],
      approvalDetails: { method: 'pr_review', approvers: [], reason: 'Godkjent' },
      verifiedAt: new Date(),
      schemaVersion: 1,
      comparisonRange: { baseSha: 'base', headSha: 'head' },
    }
  }

  it('records status, transition and run together for an unprotected deployment', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
    const id = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      fourEyesStatus: 'pending',
    })
    const stored = await storeVerificationResult(id, verificationResult(), {
      prSnapshotIds: [],
      commitSnapshotIds: [],
    })
    expect(stored.verificationRunId).toBeGreaterThan(0)
    const deployment = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [id])
    expect(deployment.rows[0].four_eyes_status).toBe('approved')
    const history = await pool.query(
      'SELECT from_status, to_status FROM deployment_status_history WHERE deployment_id = $1',
      [id],
    )
    expect(history.rows).toEqual([{ from_status: 'pending', to_status: 'approved' }])
    const runs = await pool.query('SELECT status FROM verification_runs WHERE deployment_id = $1', [id])
    expect(runs.rows).toEqual([{ status: 'approved' }])
  })

  it.each(['baseline', 'manually_approved', 'legacy'])(
    'does not shadow a concurrent protected %s approval with a verification run',
    async (status) => {
      const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
      const id = await seedDeployment(pool, {
        monitoredAppId: appId,
        teamSlug: 'team-a',
        environment: 'prod',
        fourEyesStatus: 'pending',
        commitSha: 'head',
      })
      const blocker = await pool.connect()
      let verification: Promise<unknown> | undefined
      try {
        await blocker.query('BEGIN')
        await blocker.query('SELECT id FROM deployments WHERE id = $1 FOR UPDATE', [id])
        verification = storeVerificationResult(id, verificationResult(), { prSnapshotIds: [], commitSnapshotIds: [] })
        const observed = verification.then(
          () => null,
          (error: unknown) => error,
        )
        const deadline = Date.now() + 5000
        let waiting = 0
        while (!waiting && Date.now() < deadline) {
          const { rows } = await pool.query<{ count: string }>(
            `SELECT count(*) FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'
               AND query = 'SELECT four_eyes_status FROM deployments WHERE id = $1 FOR UPDATE'`,
          )
          waiting = Number(rows[0].count)
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(waiting).toBe(1)
        await blocker.query('UPDATE deployments SET four_eyes_status = $1 WHERE id = $2', [status, id])
        await saveVerificationRun(
          id,
          { status, result: { comparisonRange: { baseSha: 'base', headSha: 'head' } } },
          { prSnapshotIds: [], commitSnapshotIds: [] },
          blocker,
        )
        await blocker.query('COMMIT')
        expect(await observed).toBeInstanceOf(Error)
        const runs = await pool.query('SELECT status FROM verification_runs WHERE deployment_id = $1', [id])
        expect(runs.rows).toEqual([{ status }])
        const deployment = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [id])
        expect(deployment.rows[0].four_eyes_status).toBe(status)
        const history = await pool.query('SELECT id FROM deployment_status_history WHERE deployment_id = $1', [id])
        expect(history.rows).toHaveLength(0)
      } finally {
        await blocker.query('ROLLBACK')
        blocker.release()
        if (verification) await Promise.allSettled([verification])
      }
    },
  )

  it('rolls back verification status and history when the run cannot be saved', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
    const id = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      fourEyesStatus: 'pending',
    })
    const result = verificationResult()
    result.approvalDetails.reason = '\u0000'
    await expect(storeVerificationResult(id, result, { prSnapshotIds: [], commitSnapshotIds: [] })).rejects.toThrow(
      'unsupported Unicode escape sequence',
    )
    const deployment = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [id])
    expect(deployment.rows[0].four_eyes_status).toBe('pending')
    for (const table of ['deployment_status_history', 'verification_runs']) {
      const rows = await pool.query(`SELECT id FROM ${table} WHERE deployment_id = $1`, [id])
      expect(rows.rows).toHaveLength(0)
    }
  })

  it.each(['manual_approval', 'legacy', 'baseline_approval'])(
    'rolls back approval writes when the verification run insert fails for %s',
    async (changeSource) => {
      const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
      const id = await seedDeployment(pool, {
        monitoredAppId: appId,
        teamSlug: 'team-a',
        environment: 'prod',
        fourEyesStatus: 'pending',
      })
      await expect(
        withTransaction(async (client) => {
          await createComment(
            {
              deployment_id: id,
              comment_text: 'Godkjent etter gjennomgang',
              comment_type: 'manual_approval',
              approved_by: 'Z990001',
              registered_by: 'Z990001',
            },
            client,
          )
          await updateDeploymentFourEyes(
            id,
            { fourEyesStatus: 'manually_approved', githubPrNumber: null, githubPrUrl: null },
            { changeSource, changedBy: 'Z990001' },
            client,
          )
          await saveVerificationRun(
            id,
            { status: 'manually_approved', result: { invalidJsonb: '\u0000' } },
            { prSnapshotIds: [], commitSnapshotIds: [] },
            client,
          )
        }),
      ).rejects.toThrow('unsupported Unicode escape sequence')

      const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [id])
      expect(rows[0].four_eyes_status).toBe('pending')
      for (const table of ['deployment_comments', 'deployment_status_history', 'verification_runs']) {
        const result = await pool.query(`SELECT id FROM ${table} WHERE deployment_id = $1`, [id])
        expect(result.rows).toHaveLength(0)
      }
    },
  )
})
