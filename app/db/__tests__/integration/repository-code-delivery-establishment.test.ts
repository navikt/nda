import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { linkDeploymentToRepositoryCodeDelivery } from '../../repository-code-deliveries.server'
import {
  establishCodeDeliveryForDeployment,
  getDeploymentIdsAwaitingCodeDelivery,
  getEstablishmentContext,
} from '../../repository-code-delivery-establishment.server'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

const SHA_100 = '1'.repeat(40)
const SHA_101 = '2'.repeat(40)
const SHA_102 = '3'.repeat(40)

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

async function createRepository(options: { tracking?: boolean; githubRepoId?: string } = {}) {
  const githubRepoId = options.githubRepoId ?? '900'
  const repositoryId = await seedRepository(pool, {
    githubRepoId,
    githubOwner: 'navikt',
    githubRepoName: `repo-${githubRepoId}`,
  })
  await pool.query('UPDATE repositories SET code_delivery_tracking = $1 WHERE id = $2', [
    options.tracking ?? true,
    repositoryId,
  ])
  return repositoryId
}

async function createApp(name: string) {
  return seedApp(pool, { teamSlug: 'team-fjord', appName: name, environment: 'prod-gcp' })
}

async function createDeployment(options: {
  appId: number
  appName: string
  repositoryId: number | null
  commitSha: string | null
  createdAt?: Date
}) {
  const deploymentId = await seedDeployment(pool, {
    monitoredAppId: options.appId,
    teamSlug: 'team-fjord',
    appName: options.appName,
    environment: 'prod-gcp',
    commitSha: options.commitSha,
    createdAt: options.createdAt,
  })
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [options.repositoryId, deploymentId])
  return deploymentId
}

async function confirmed(deploymentId: number, baseSha: string | null = null) {
  const { rows } = await pool.query<{ commit_sha: string }>('SELECT commit_sha FROM deployments WHERE id = $1', [
    deploymentId,
  ])
  return { confirmed: true, baseSha, headSha: rows[0]?.commit_sha ?? SHA_100 } as const
}

async function establish(deploymentId: number, baseSha: string | null = null) {
  return establishCodeDeliveryForDeployment(deploymentId, await confirmed(deploymentId, baseSha))
}

async function establishUnresolved(
  deploymentId: number,
  reason: 'ancestry_unknown' | 'ancestry_diverged' | 'ancestry_behind' | 'source_unauthorized' | 'source_unknown',
) {
  const { headSha } = await confirmed(deploymentId)
  return establishCodeDeliveryForDeployment(deploymentId, { confirmed: false, reason, headSha })
}

async function getDeliveries(repositoryId: number) {
  const { rows } = await pool.query<{ id: number; base_sha: string; head_sha: string }>(
    'SELECT id, base_sha, head_sha FROM repository_code_deliveries WHERE repository_id = $1 ORDER BY id',
    [repositoryId],
  )
  return rows
}

async function getUnresolved(deploymentId: number) {
  const { rows } = await pool.query<{ reason: string; resolved_at: Date | null }>(
    'SELECT reason, resolved_at FROM repository_code_delivery_unresolved WHERE deployment_id = $1',
    [deploymentId],
  )
  return rows[0] ?? null
}

async function getLinkedDeliveryId(deploymentId: number) {
  const { rows } = await pool.query<{ repository_code_delivery_id: number | null }>(
    'SELECT repository_code_delivery_id FROM deployments WHERE id = $1',
    [deploymentId],
  )
  return rows[0].repository_code_delivery_id
}

describe('establishCodeDeliveryForDeployment', () => {
  it('uses the head as base for the first delivery of a repository', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    const result = await establish(deploymentId)

    expect(result.outcome).toBe('created')
    expect(await getDeliveries(repositoryId)).toEqual([
      expect.objectContaining({ base_sha: SHA_100, head_sha: SHA_100 }),
    ])
    expect(await getLinkedDeliveryId(deploymentId)).not.toBeNull()
  })

  it('chains deliveries across apps in the same repository', async () => {
    const repositoryId = await createRepository()
    const appA = await createApp('app-a')
    const appB = await createApp('app-b')
    const a100 = await createDeployment({ appId: appA, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const b101 = await createDeployment({ appId: appB, appName: 'app-b', repositoryId, commitSha: SHA_101 })
    const a102 = await createDeployment({ appId: appA, appName: 'app-a', repositoryId, commitSha: SHA_102 })
    const b102 = await createDeployment({ appId: appB, appName: 'app-b', repositoryId, commitSha: SHA_102 })

    await establish(a100)
    await establish(b101, SHA_100)
    const first102 = await establish(a102, SHA_101)
    const second102 = await establish(b102, SHA_101)

    expect(await getDeliveries(repositoryId)).toEqual([
      expect.objectContaining({ base_sha: SHA_100, head_sha: SHA_100 }),
      expect.objectContaining({ base_sha: SHA_100, head_sha: SHA_101 }),
      expect.objectContaining({ base_sha: SHA_101, head_sha: SHA_102 }),
    ])
    expect(first102.outcome).toBe('created')
    expect(second102.outcome).toBe('linked')
    expect(await getLinkedDeliveryId(a102)).toBe(await getLinkedDeliveryId(b102))
  })

  it('does not move progress back on rollback to a known SHA', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const ids = []
    for (const sha of [SHA_100, SHA_101, SHA_102, SHA_100]) {
      ids.push(await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: sha }))
    }
    const bases = [null, SHA_100, SHA_101, SHA_102]
    for (const [index, id] of ids.entries()) {
      await establish(id, bases[index])
    }

    const sha103 = '4'.repeat(40)
    const next = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: sha103 })
    await establish(next, SHA_102)

    const deliveries = await getDeliveries(repositoryId)
    expect(deliveries).toHaveLength(4)
    expect(deliveries[3]).toEqual(expect.objectContaining({ base_sha: SHA_102, head_sha: sha103 }))
    expect(await getLinkedDeliveryId(ids[3])).toBe(await getLinkedDeliveryId(ids[0]))
  })

  it('keeps a delivery without code approval as base for the next delivery', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const first = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const second = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_101 })

    await establish(first)
    await establish(second, SHA_100)

    expect((await getDeliveries(repositoryId))[1]).toEqual(expect.objectContaining({ base_sha: SHA_100 }))
  })

  it('creates one delivery when the same SHA is established concurrently', async () => {
    const repositoryId = await createRepository()
    const appA = await createApp('app-a')
    const appB = await createApp('app-b')
    const a = await createDeployment({ appId: appA, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    const b = await createDeployment({ appId: appB, appName: 'app-b', repositoryId, commitSha: SHA_101 })

    const results = await Promise.all([establish(a), establish(b)])

    expect(results.map((result) => result.outcome).sort()).toEqual(['created', 'linked'])
    expect(await getDeliveries(repositoryId)).toHaveLength(1)
    expect(await getLinkedDeliveryId(a)).toBe(await getLinkedDeliveryId(b))
  })

  it('reports stale grounds instead of chaining from an unverified head when different SHAs race', async () => {
    const repositoryId = await createRepository()
    const appA = await createApp('app-a')
    const appB = await createApp('app-b')
    const a = await createDeployment({ appId: appA, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    const b = await createDeployment({ appId: appB, appName: 'app-b', repositoryId, commitSha: SHA_102 })

    const results = await Promise.all([establish(a), establish(b)])

    expect(results.map((result) => result.outcome).sort()).toEqual(['created', 'stale_grounds'])
    expect(await getDeliveries(repositoryId)).toHaveLength(1)
    const staleDeploymentId = results[0].outcome === 'stale_grounds' ? a : b
    expect(await getLinkedDeliveryId(staleDeploymentId)).toBeNull()
  })

  it('rejects grounds confirmed for a different head SHA than the deployment has', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const grounds = await confirmed(deploymentId)
    await pool.query('UPDATE deployments SET commit_sha = $1 WHERE id = $2', [SHA_101, deploymentId])

    expect(await establishCodeDeliveryForDeployment(deploymentId, grounds)).toEqual({ outcome: 'stale_grounds' })
    expect(await getDeliveries(repositoryId)).toEqual([])
    expect(await getLinkedDeliveryId(deploymentId)).toBeNull()
  })

  it('rejects unresolved grounds evaluated for a different head SHA than the deployment has', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    await pool.query('UPDATE deployments SET commit_sha = $1 WHERE id = $2', [SHA_101, deploymentId])

    const result = await establishCodeDeliveryForDeployment(deploymentId, {
      confirmed: false,
      reason: 'ancestry_unknown',
      headSha: SHA_100,
    })

    expect(result).toEqual({ outcome: 'stale_grounds' })
    expect(await getUnresolved(deploymentId)).toBeNull()
  })

  it('rejects stale head grounds before linking to an existing delivery', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const first = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const second = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    await establish(first)
    const grounds = await confirmed(second)
    await pool.query('UPDATE deployments SET commit_sha = $1 WHERE id = $2', [SHA_101, second])

    expect(await establishCodeDeliveryForDeployment(second, grounds)).toEqual({ outcome: 'stale_grounds' })
    expect(await getLinkedDeliveryId(second)).toBeNull()
  })

  it('rejects grounds confirmed against an outdated base', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const first = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const second = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    const third = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_102 })
    await establish(first)
    await establish(second, SHA_100)

    expect(await establish(third, SHA_100)).toEqual({
      outcome: 'stale_grounds',
    })
    expect(await getDeliveries(repositoryId)).toHaveLength(2)
  })

  it('does nothing when tracking is disabled', async () => {
    const repositoryId = await createRepository({ tracking: false })
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    expect(await establish(deploymentId)).toEqual({
      outcome: 'skipped',
      reason: 'tracking_disabled',
    })
    expect(await getDeliveries(repositoryId)).toEqual([])
    expect(await getLinkedDeliveryId(deploymentId)).toBeNull()
  })

  it('skips deployments without repository identity', async () => {
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId: null, commitSha: SHA_100 })

    expect(await establish(deploymentId)).toEqual({
      outcome: 'skipped',
      reason: 'missing_repository',
    })
  })

  it.each([null, 'abc123'])('skips deployments without a full commit SHA (%s)', async (commitSha) => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha })

    expect(await establish(deploymentId)).toEqual({
      outcome: 'skipped',
      reason: 'missing_commit_sha',
    })
    expect(await getDeliveries(repositoryId)).toEqual([])
  })

  it.each([
    'ancestry_unknown',
    'ancestry_diverged',
    'ancestry_behind',
    'source_unauthorized',
    'source_unknown',
  ] as const)('does not create or link when grounds are unresolved (%s)', async (reason) => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const established = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const unresolved = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    await establish(established)

    expect(await establishUnresolved(unresolved, reason)).toEqual({
      outcome: 'unresolved',
      reason,
    })
    expect(await getDeliveries(repositoryId)).toHaveLength(1)
    expect(await getLinkedDeliveryId(unresolved)).toBeNull()
    expect(await getUnresolved(unresolved)).toEqual({ reason, resolved_at: null })
  })

  it('does not let an unresolved deployment block a later confirmed deployment of the same SHA', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const first = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const second = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    await establishUnresolved(first, 'source_unauthorized')
    const result = await establish(second)

    expect(result.outcome).toBe('created')
    expect(await getLinkedDeliveryId(first)).toBeNull()
    expect(await getLinkedDeliveryId(second)).not.toBeNull()
    expect(await getUnresolved(first)).toEqual({ reason: 'source_unauthorized', resolved_at: null })
    expect(await getUnresolved(second)).toBeNull()
  })

  it('updates the reason when the same deployment is unresolved again', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    await establishUnresolved(deploymentId, 'ancestry_unknown')
    await establishUnresolved(deploymentId, 'ancestry_diverged')

    expect(await getUnresolved(deploymentId)).toEqual({ reason: 'ancestry_diverged', resolved_at: null })
  })

  it('marks an unresolved deployment as resolved once it is linked', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    await establishUnresolved(deploymentId, 'ancestry_unknown')

    await establish(deploymentId)

    const unresolved = await getUnresolved(deploymentId)
    expect(unresolved?.reason).toBe('ancestry_unknown')
    expect(unresolved?.resolved_at).not.toBeNull()
  })

  it('marks an unresolved deployment as resolved when linked through the public link function', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const first = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const second = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const created = await establish(first)
    await establishUnresolved(second, 'ancestry_unknown')

    await linkDeploymentToRepositoryCodeDelivery(second, (created as { deliveryId: number }).deliveryId)

    expect((await getUnresolved(second))?.resolved_at).not.toBeNull()
  })

  it('marks an unresolved deployment as resolved when it is already linked', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    await establish(deploymentId)
    await pool.query(
      `INSERT INTO repository_code_delivery_unresolved (deployment_id, reason) VALUES ($1, 'ancestry_unknown')`,
      [deploymentId],
    )

    expect((await establish(deploymentId)).outcome).toBe('already_linked')

    expect((await getUnresolved(deploymentId))?.resolved_at).not.toBeNull()
  })

  it('does not register unresolved for skipped deployments', async () => {
    const repositoryId = await createRepository({ tracking: false })
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    await establishUnresolved(deploymentId, 'ancestry_unknown')

    expect(await getUnresolved(deploymentId)).toBeNull()
  })

  it('does not register unresolved for stale grounds', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    await establishCodeDeliveryForDeployment(deploymentId, { confirmed: true, baseSha: SHA_101, headSha: SHA_100 })

    expect(await getUnresolved(deploymentId)).toBeNull()
  })

  it('is idempotent for an already linked deployment', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const first = await establish(deploymentId)

    const second = await establish(deploymentId)

    expect(first.outcome).toBe('created')
    expect(second).toEqual({ outcome: 'already_linked', deliveryId: (first as { deliveryId: number }).deliveryId })
    expect(await getDeliveries(repositoryId)).toHaveLength(1)
  })

  it('revalidates an existing link and rejects a link that no longer matches the deployment', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    await establish(deploymentId)
    await pool.query('UPDATE deployments SET commit_sha = $1 WHERE id = $2', [SHA_101, deploymentId])

    await expect(establish(deploymentId)).rejects.toThrow('full head SHA')
  })

  it('keeps delivery chains separate per repository', async () => {
    const repositoryA = await createRepository({ githubRepoId: '901' })
    const repositoryB = await createRepository({ githubRepoId: '902' })
    const appId = await createApp('app-a')
    const a = await createDeployment({ appId, appName: 'app-a', repositoryId: repositoryA, commitSha: SHA_100 })
    const b = await createDeployment({ appId, appName: 'app-a', repositoryId: repositoryB, commitSha: SHA_101 })

    await establish(a)
    await establish(b)

    expect(await getDeliveries(repositoryB)).toEqual([
      expect.objectContaining({ base_sha: SHA_101, head_sha: SHA_101 }),
    ])
  })

  it('rejects unknown deployments', async () => {
    await expect(establish(999999)).rejects.toThrow('was not found')
  })
})

describe('getEstablishmentContext', () => {
  it('returns repository coordinates, latest delivery head and whether the head has a delivery', async () => {
    const repositoryId = await createRepository()
    await pool.query(`UPDATE repositories SET default_branch = 'main' WHERE id = $1`, [repositoryId])
    const appId = await createApp('app-a')
    const first = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const second = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    await establish(first)

    expect(await getEstablishmentContext(second)).toEqual({
      repositoryId,
      githubOwner: 'navikt',
      githubRepoName: 'repo-900',
      githubRepoId: 900,
      defaultBranch: 'main',
      headSha: SHA_101,
      latestDeliveryHeadSha: SHA_100,
      headHasDelivery: false,
    })
    expect((await getEstablishmentContext(first))?.headHasDelivery).toBe(true)
  })

  it('returns null when tracking is disabled, repository is missing or the SHA is not full', async () => {
    const disabled = await createRepository({ tracking: false, githubRepoId: '901' })
    const enabled = await createRepository({ githubRepoId: '902' })
    const appId = await createApp('app-a')
    const trackingOff = await createDeployment({ appId, appName: 'app-a', repositoryId: disabled, commitSha: SHA_100 })
    const noRepository = await createDeployment({ appId, appName: 'app-a', repositoryId: null, commitSha: SHA_100 })
    const shortSha = await createDeployment({ appId, appName: 'app-a', repositoryId: enabled, commitSha: 'abc123' })

    expect(await getEstablishmentContext(trackingOff)).toBeNull()
    expect(await getEstablishmentContext(noRepository)).toBeNull()
    expect(await getEstablishmentContext(shortSha)).toBeNull()
  })
})

describe('code delivery tracking start', () => {
  it('records when tracking was enabled', async () => {
    const repositoryId = await createRepository({ tracking: false })
    const before = await pool.query('SELECT code_delivery_tracking_since FROM repositories WHERE id = $1', [
      repositoryId,
    ])
    expect(before.rows[0].code_delivery_tracking_since).toBeNull()

    await pool.query('UPDATE repositories SET code_delivery_tracking = true WHERE id = $1', [repositoryId])

    const after = await pool.query('SELECT code_delivery_tracking_since FROM repositories WHERE id = $1', [
      repositoryId,
    ])
    expect(after.rows[0].code_delivery_tracking_since).not.toBeNull()
  })
})

describe('getDeploymentIdsAwaitingCodeDelivery', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('returns only newer, unlinked, full-SHA deployments of tracked repositories in creation order', async () => {
    const repositoryId = await createRepository()
    const untracked = await createRepository({ tracking: false, githubRepoId: '901' })
    const appId = await createApp('app-a')
    const old = await createDeployment({
      appId,
      appName: 'app-a',
      repositoryId,
      commitSha: SHA_100,
      createdAt: new Date(Date.now() - 2 * DAY),
    })
    const later = await createDeployment({
      appId,
      appName: 'app-a',
      repositoryId,
      commitSha: SHA_102,
      createdAt: new Date(Date.now() + 2000),
    })
    const earlier = await createDeployment({
      appId,
      appName: 'app-a',
      repositoryId,
      commitSha: SHA_101,
      createdAt: new Date(Date.now() + 1000),
    })
    const linked = await createDeployment({
      appId,
      appName: 'app-a',
      repositoryId,
      commitSha: SHA_101,
      createdAt: new Date(Date.now() + 3000),
    })
    await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: 'abc123' })
    await createDeployment({ appId, appName: 'app-a', repositoryId: untracked, commitSha: SHA_100 })
    await establish(linked)

    const ids = await getDeploymentIdsAwaitingCodeDelivery(100)

    expect(ids).toEqual([earlier, later])
    expect(ids).not.toContain(old)
  })

  it('respects the limit', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    for (const [index, sha] of [SHA_100, SHA_101, SHA_102].entries()) {
      await createDeployment({
        appId,
        appName: 'app-a',
        repositoryId,
        commitSha: sha,
        createdAt: new Date(Date.now() + index * 1000),
      })
    }

    expect(await getDeploymentIdsAwaitingCodeDelivery(2)).toHaveLength(2)
  })

  it('excludes open unresolved deployments but retries stale unknown ones', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const diverged = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const unknownFresh = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    const unknownStale = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_102 })
    const sourceUnknownStale = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_102 })
    const unauthorized = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_102 })
    const behind = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_102 })
    await pool.query(
      `INSERT INTO repository_code_delivery_unresolved (deployment_id, reason, updated_at) VALUES
        ($1, 'ancestry_diverged', now() - interval '3 hours'),
        ($2, 'ancestry_unknown', now()),
        ($3, 'ancestry_unknown', now() - interval '3 hours'),
        ($4, 'source_unknown', now() - interval '3 hours'),
        ($5, 'source_unauthorized', now() - interval '3 hours'),
        ($6, 'ancestry_behind', now() - interval '3 hours')`,
      [diverged, unknownFresh, unknownStale, sourceUnknownStale, unauthorized, behind],
    )

    expect(await getDeploymentIdsAwaitingCodeDelivery(100)).toEqual([unknownStale, sourceUnknownStale])
  })
})
