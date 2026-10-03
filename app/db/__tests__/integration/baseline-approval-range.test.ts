import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createComment } from '~/db/comments.server'
import { getLatestVerificationRun } from '~/db/github-data.server'
import { findRootApprovedSiblingForCommit } from '~/lib/verification/fetch-data/previous-deployment.server'
import { action } from '~/routes/deployments/$id.actions.server'
import { seedApp, seedApplicationRepository, seedDeployment, truncateAllTables } from './helpers'

vi.mock('~/lib/auth.server', () => ({
  getUserIdentity: vi.fn().mockImplementation(async (request: Request) => ({
    navIdent: request.headers.get('x-test-nav-ident') ?? 'Z990001',
  })),
}))
vi.mock('~/lib/authorization.server', () => ({
  resolveDeploymentCapabilities: vi.fn().mockResolvedValue({ canApprove: true }),
}))
vi.mock('~/lib/verification', () => ({ runVerification: vi.fn() }))
vi.mock('~/lib/slack/client.server', () => ({
  notifyDeploymentIfNeeded: vi.fn(),
  sendDeviationNotification: vi.fn(),
}))
vi.mock('~/lib/github', () => ({
  getCommitAncestryStatus: vi.fn().mockResolvedValue('identical'),
  getGitHubRateLimitRemaining: vi.fn().mockReturnValue(null),
  lookupLegacyByCommit: vi.fn(),
  lookupLegacyByPR: vi.fn(),
}))

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

describe('baseline approval recorded range', () => {
  it.each([
    { intent: 'approve_legacy', status: 'baseline' },
    { intent: 'approve_legacy', status: 'manually_approved' },
    { intent: 'manual_approval', status: 'baseline' },
    { intent: 'manual_approval', status: 'manually_approved' },
    { intent: 'manual_approval', status: 'legacy' },
  ])('does not let a stale $intent overwrite concurrent $status approval', async ({ intent, status }) => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'source', environment: 'prod' })
    const id = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: null,
      fourEyesStatus: 'pending_approval',
    })
    await createComment({
      deployment_id: id,
      comment_text: 'Legacy-info',
      comment_type: 'legacy_info',
      registered_by: 'Z990002',
    })
    const blocker = await pool.connect()
    let approval: ReturnType<typeof action> | undefined
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM deployments WHERE id = $1 FOR UPDATE', [id])
      const form = new FormData()
      form.set('intent', intent)
      approval = action({
        request: new Request(`http://localhost/deployments/${id}`, { method: 'POST', body: form }),
        params: { id: String(id) },
        url: new URL(`http://localhost/deployments/${id}`),
      })
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
      await blocker.query('COMMIT')
      expect(await approval).toHaveProperty('error')
      const deployment = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [id])
      expect(deployment.rows[0].four_eyes_status).toBe(status)
      const comments = await pool.query('SELECT comment_type FROM deployment_comments WHERE deployment_id = $1', [id])
      expect(comments.rows).toEqual([{ comment_type: 'legacy_info' }])
      for (const table of ['deployment_status_history', 'verification_runs']) {
        const result = await pool.query(`SELECT id FROM ${table} WHERE deployment_id = $1`, [id])
        expect(result.rows).toHaveLength(0)
      }
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      if (approval) await Promise.allSettled([approval])
    }
  })

  it('records only one approval and run when two users concurrently approve a pending baseline', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'source', environment: 'prod' })
    const id = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      fourEyesStatus: 'pending_baseline',
    })
    const blocker = await pool.connect()
    let approvals: ReturnType<typeof action>[] = []
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT id FROM deployments WHERE id = $1 FOR UPDATE', [id])
      approvals = ['Z990001', 'Z990002'].map((navIdent) => {
        const form = new FormData()
        form.set('intent', 'approve_baseline')
        return action({
          request: new Request(`http://localhost/deployments/${id}`, {
            method: 'POST',
            body: form,
            headers: { 'x-test-nav-ident': navIdent },
          }),
          params: { id: String(id) },
          url: new URL(`http://localhost/deployments/${id}`),
        })
      })
      const deadline = Date.now() + 5000
      let waiting = 0
      while (waiting < 2 && Date.now() < deadline) {
        const { rows } = await pool.query<{ count: string }>(
          `SELECT count(*) FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND query = 'SELECT four_eyes_status FROM deployments WHERE id = $1 FOR UPDATE'`,
        )
        waiting = Number(rows[0].count)
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(waiting).toBe(2)
      await blocker.query('COMMIT')
      const results = await Promise.all(approvals)
      expect(results.filter((result) => result?.success)).toHaveLength(1)
      expect(results.filter((result) => result?.error)).toHaveLength(1)

      const history = await pool.query(
        `SELECT changed_by FROM deployment_status_history
         WHERE deployment_id = $1 AND change_source = 'baseline_approval'`,
        [id],
      )
      expect(history.rows).toEqual([{ changed_by: results[0]?.success ? 'Z990001' : 'Z990002' }])
      const runs = await pool.query('SELECT status FROM verification_runs WHERE deployment_id = $1', [id])
      expect(runs.rows).toEqual([{ status: 'baseline' }])
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
      await Promise.allSettled(approvals)
    }
  })

  it.each(['pending_baseline', 'baseline'])(
    'records a usable sibling root when approving %s through the production action',
    async (fourEyesStatus) => {
      async function linkedApp(appName: string) {
        const id = await seedApp(pool, { teamSlug: 'team-a', appName, environment: 'prod' })
        await seedApplicationRepository(pool, {
          monitoredAppId: id,
          githubOwner: 'navikt',
          githubRepo: 'monorepo',
          githubRepoId: '9001',
        })
        return id
      }
      const sourceApp = await linkedApp('source')
      const targetApp = await linkedApp('target')
      const source = await seedDeployment(pool, {
        monitoredAppId: sourceApp,
        teamSlug: 'team-a',
        environment: 'prod',
        commitSha: 'head',
        githubOwner: 'navikt',
        githubRepo: 'monorepo',
        fourEyesStatus,
        createdAt: new Date('2026-01-01T10:00:00Z'),
      })
      const target = await seedDeployment(pool, {
        monitoredAppId: targetApp,
        teamSlug: 'team-a',
        environment: 'prod',
        commitSha: 'head',
        githubOwner: 'navikt',
        githubRepo: 'monorepo',
        fourEyesStatus: 'pending',
        createdAt: new Date('2026-01-02T10:00:00Z'),
      })
      const form = new FormData()
      form.set('intent', 'approve_baseline')
      form.set('comparison_head_sha', 'head')
      form.set('comparison_base_sha', '')
      const result = await action({
        request: new Request(`http://localhost/deployments/${source}`, { method: 'POST', body: form }),
        params: { id: String(source) },
        url: new URL(`http://localhost/deployments/${source}`),
      })
      expect(result).toHaveProperty('success')
      await expect(getLatestVerificationRun(source)).resolves.toMatchObject({
        status: 'baseline',
        result: { comparisonRange: { baseSha: null, headSha: 'head' } },
      })
      await expect(findRootApprovedSiblingForCommit('head', '9001', null, target, targetApp)).resolves.toMatchObject({
        id: source,
        fourEyesStatus: 'baseline',
      })
      const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [target])
      expect(rows[0].four_eyes_status).toBe('pending')
    },
  )
})
