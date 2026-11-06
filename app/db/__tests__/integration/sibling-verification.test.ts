import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { closePool, withTransaction } from '~/db/connection.server'
import { propagateVerificationToSiblings } from '~/db/monorepo.server'
import {
  getBlockingSiblingCandidates,
  getDueSiblingWaiters,
  getSiblingQueueStats,
  isCurrentSiblingRoot,
  lockSiblingWork,
  wakeChangedSiblingWaiters,
} from '~/db/sibling-verification.server'
import { storeVerificationResult } from '~/lib/verification/store-data.server'
import type { VerificationResult } from '~/lib/verification/types'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

let pool: Pool
beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})
afterEach(async () => {
  await truncateAllTables(pool)
})
afterAll(async () => {
  await closePool()
  await pool.end()
})

async function seedPair() {
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'example',
    defaultBranch: 'main',
  })
  const sourceApp = await seedApp(pool, { teamSlug: 'team', appName: 'source', environment: 'prod-fss' })
  const waiterApp = await seedApp(pool, { teamSlug: 'team', appName: 'waiter', environment: 'prod-gcp' })
  for (const appId of [sourceApp, waiterApp]) {
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'example',
      githubRepoId: '123',
    })
  }
  const source = await seedDeployment(pool, {
    monitoredAppId: sourceApp,
    teamSlug: 'team',
    environment: 'prod-fss',
    commitSha: 'b'.repeat(40),
    fourEyesStatus: 'unverified_commits',
    githubOwner: 'navikt',
    githubRepo: 'example',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })
  const waiter = await seedDeployment(pool, {
    monitoredAppId: waiterApp,
    teamSlug: 'team',
    environment: 'prod-gcp',
    commitSha: 'b'.repeat(40),
    fourEyesStatus: 'pending_sibling_resolution',
    githubOwner: 'navikt',
    githubRepo: 'example',
    createdAt: new Date('2026-01-02T00:00:00Z'),
  })
  const basis = {
    version: 1,
    repositoryId,
    commitSha: 'b'.repeat(40),
    baseBranch: 'main',
    configuredBaseBranch: 'main',
    auditStartYear: null,
    implicitApprovalMode: 'off',
    repositoryStatus: 'active',
    candidateId: source,
    candidateStatus: 'unverified_commits',
    decision: 'original',
  }
  await pool.query(
    `UPDATE deployments SET sibling_wait_candidate_id = $2, sibling_wait_basis = $3,
      sibling_wait_checked_at = now() - interval '1 hour', sibling_next_attempt_at = now() + interval '1 day'
      WHERE id = $1`,
    [waiter, source, JSON.stringify(basis)],
  )
  return { repositoryId, sourceApp, waiterApp, source, waiter }
}

it('does no full work for unchanged future waiters and wakes them when the root becomes approved', async () => {
  const { source, waiter, waiterApp } = await seedPair()
  expect(await wakeChangedSiblingWaiters(waiterApp)).toBe(0)
  expect(await getDueSiblingWaiters(waiterApp)).toEqual([])
  await pool.query("UPDATE deployments SET four_eyes_status = 'manually_approved' WHERE id = $1", [source])
  expect(await wakeChangedSiblingWaiters(waiterApp)).toBe(1)
  expect((await getDueSiblingWaiters(waiterApp)).map(({ id }) => id)).toEqual([waiter])
})

it('delays the first automatic sibling retry after an ordinary verification', async () => {
  const { waiter, waiterApp, source, sourceApp } = await seedPair()
  const result: VerificationResult = {
    status: 'pending_sibling_resolution',
    hasFourEyes: false,
    deployedPr: null,
    unverifiedCommits: [],
    approvalDetails: { method: null, approvers: [], reason: 'Waiting for sibling' },
    verifiedAt: new Date(),
    schemaVersion: 5,
  }
  await storeVerificationResult(
    waiter,
    result,
    { prSnapshotIds: [], commitSnapshotIds: [] },
    {
      commitSha: 'b'.repeat(40),
      monitoredAppId: waiterApp,
      previousDeployment: {
        id: source,
        monitoredAppId: sourceApp,
        commitSha: 'b'.repeat(40),
        createdAt: '2026-01-01T00:00:00Z',
        fourEyesStatus: 'unverified_commits',
      },
    },
  )
  const { rows } = await pool.query(
    `SELECT sibling_wait_basis, sibling_retry_count,
       sibling_next_attempt_at >= sibling_wait_checked_at + interval '15 minutes' AS delayed
     FROM deployments WHERE id = $1`,
    [waiter],
  )
  expect(rows[0]).toEqual({ sibling_wait_basis: null, sibling_retry_count: 0, delayed: true })
  expect(await wakeChangedSiblingWaiters(waiterApp)).toBe(0)
  expect(await getDueSiblingWaiters(waiterApp)).toEqual([])
  expect((await pool.query('SELECT id FROM verification_runs WHERE deployment_id = $1', [waiter])).rows).toHaveLength(1)
  await pool.query(
    `UPDATE deployments SET sibling_wait_checked_at = now() - interval '16 minutes',
       sibling_next_attempt_at = now() - interval '1 minute' WHERE id = $1`,
    [waiter],
  )
  expect((await getDueSiblingWaiters(waiterApp)).map(({ id }) => id)).toEqual([waiter])
})

it('compares configured branch rather than the live GitHub branch used by Nais Apply', async () => {
  const { waiter, waiterApp } = await seedPair()
  await pool.query(
    `UPDATE deployments SET sibling_wait_basis = jsonb_set(sibling_wait_basis, '{baseBranch}', '"master"')
     WHERE id = $1`,
    [waiter],
  )
  expect(await wakeChangedSiblingWaiters(waiterApp)).toBe(0)
  await pool.query("UPDATE monitored_applications SET default_branch = 'other' WHERE id = $1", [waiterApp])
  expect(await wakeChangedSiblingWaiters(waiterApp)).toBe(0)
  await pool.query("UPDATE repositories SET default_branch = 'other'")
  expect(await wakeChangedSiblingWaiters(waiterApp)).toBe(1)
})

it('surfaces unserviceable waiters rather than retrying ambiguous repository identity', async () => {
  const { waiter, waiterApp } = await seedPair()
  await pool.query('UPDATE deployments SET sibling_next_attempt_at = NULL WHERE id = $1', [waiter])
  expect(await getSiblingQueueStats(waiterApp)).toEqual({
    waiting: 1,
    unavailable: 0,
    due: 1,
    oldestDueAt: new Date('2026-01-02T00:00:00Z'),
  })
  await seedRepository(pool, {
    githubRepoId: '456',
    githubOwner: 'navikt',
    githubRepoName: 'example',
  })
  expect(await getDueSiblingWaiters(waiterApp)).toEqual([])
  expect(await getSiblingQueueStats(waiterApp)).toEqual({
    waiting: 1,
    unavailable: 1,
    due: 0,
    oldestDueAt: null,
  })
})

it('selects only actual active negative blockers and never crosses repository identity on reused names', async () => {
  const { source, sourceApp } = await seedPair()
  expect((await getBlockingSiblingCandidates()).map(({ id }) => id)).toEqual([source])
  await seedRepository(pool, {
    githubRepoId: '456',
    githubOwner: 'navikt',
    githubRepoName: 'example',
  })
  expect(await getBlockingSiblingCandidates()).toEqual([])
  await pool.query('DELETE FROM repositories WHERE github_repo_id = $1', ['456'])
  await pool.query('UPDATE monitored_applications SET is_active = false WHERE id = $1', [sourceApp])
  expect(await getBlockingSiblingCandidates()).toEqual([])
})

it('wakes on a different earlier root and never bulk-approves pending sibling targets', async () => {
  const { source, sourceApp, waiter, waiterApp } = await seedPair()
  const root = await seedDeployment(pool, {
    monitoredAppId: sourceApp,
    teamSlug: 'team',
    environment: 'prod-fss',
    commitSha: 'b'.repeat(40),
    fourEyesStatus: 'approved',
    githubOwner: 'navikt',
    githubRepo: 'example',
    createdAt: new Date('2025-12-31T00:00:00Z'),
  })
  expect(await propagateVerificationToSiblings(root, 'approved', 'b'.repeat(40), sourceApp)).toBe(0)
  expect(await wakeChangedSiblingWaiters(waiterApp)).toBe(1)
  const [work] = await getDueSiblingWaiters(waiterApp)
  expect(work.id).toBe(waiter)
  await withTransaction(async (client) => {
    expect(await isCurrentSiblingRoot(client, work, source, 'unverified_commits')).toBe(false)
    expect(await isCurrentSiblingRoot(client, work, root, 'approved')).toBe(true)
    await client.query("UPDATE deployments SET four_eyes_status = 'verified_via_sibling' WHERE id = $1", [root])
    expect(await isCurrentSiblingRoot(client, work, root, 'verified_via_sibling')).toBe(false)
  })
})

it('fences null basis, microsecond timestamps, and concurrent retry or manual changes', async () => {
  const { waiter, waiterApp } = await seedPair()
  await pool.query(
    `UPDATE deployments SET sibling_wait_basis = NULL, sibling_next_attempt_at = NULL,
      sibling_wait_checked_at = '2026-01-02 00:00:00.123456+00',
      created_at = '2026-01-02 00:00:00.654321+00' WHERE id = $1`,
    [waiter],
  )
  const [work] = await getDueSiblingWaiters(waiterApp)
  expect(work.sibling_wait_checked_at).toContain('123456')
  await withTransaction(async (client) => {
    expect(await lockSiblingWork(client, work)).toBe(true)
    await client.query('UPDATE deployments SET sibling_retry_count = sibling_retry_count + 1 WHERE id = $1', [waiter])
    expect(await lockSiblingWork(client, work)).toBe(false)
    await client.query("UPDATE deployments SET four_eyes_status = 'manually_approved' WHERE id = $1", [waiter])
    expect(await lockSiblingWork(client, work)).toBe(false)
  })
})

it('rolls back status, decision history and retry metadata as a single transaction', async () => {
  const { waiter, waiterApp } = await seedPair()
  await pool.query('UPDATE deployments SET sibling_next_attempt_at = NULL WHERE id = $1', [waiter])
  const [work] = await getDueSiblingWaiters(waiterApp)
  const result: VerificationResult = {
    status: 'unverified_commits',
    hasFourEyes: false,
    deployedPr: null,
    unverifiedCommits: [],
    approvalDetails: { method: null, approvers: [], reason: 'Missing review' },
    verifiedAt: new Date(),
    schemaVersion: 5,
  }
  await expect(
    withTransaction(async (client) => {
      expect(await lockSiblingWork(client, work)).toBe(true)
      await storeVerificationResult(
        waiter,
        result,
        { prSnapshotIds: [], commitSnapshotIds: [] },
        {
          commitSha: work.commit_sha,
          previousDeployment: null,
        },
        'sibling_reverification',
        undefined,
        { executor: client, githubPrDataJson: null },
      )
      await client.query('UPDATE deployments SET sibling_retry_count = 10 WHERE id = $1', [waiter])
      throw new Error('Abort atomic write')
    }),
  ).rejects.toThrow('Abort atomic write')
  const { rows } = await pool.query('SELECT four_eyes_status, sibling_retry_count FROM deployments WHERE id = $1', [
    waiter,
  ])
  expect(rows[0]).toEqual({ four_eyes_status: 'pending_sibling_resolution', sibling_retry_count: 0 })
  expect((await pool.query('SELECT id FROM verification_runs WHERE deployment_id = $1', [waiter])).rows).toEqual([])
  expect(
    (await pool.query('SELECT id FROM deployment_status_history WHERE deployment_id = $1', [waiter])).rows,
  ).toEqual([])
})
