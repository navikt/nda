import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { establishCodeDeliveryForDeployment } from '../../repository-code-delivery-establishment.server'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

const SHA_100 = '1'.repeat(40)
const SHA_101 = '2'.repeat(40)
const SHA_102 = '3'.repeat(40)
const CONFIRMED = { confirmed: true } as const

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
}) {
  const deploymentId = await seedDeployment(pool, {
    monitoredAppId: options.appId,
    teamSlug: 'team-fjord',
    appName: options.appName,
    environment: 'prod-gcp',
    commitSha: options.commitSha,
  })
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [options.repositoryId, deploymentId])
  return deploymentId
}

async function getDeliveries(repositoryId: number) {
  const { rows } = await pool.query<{ id: number; base_sha: string; head_sha: string }>(
    'SELECT id, base_sha, head_sha FROM repository_code_deliveries WHERE repository_id = $1 ORDER BY id',
    [repositoryId],
  )
  return rows
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

    const result = await establishCodeDeliveryForDeployment(deploymentId, CONFIRMED)

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

    await establishCodeDeliveryForDeployment(a100, CONFIRMED)
    await establishCodeDeliveryForDeployment(b101, CONFIRMED)
    const first102 = await establishCodeDeliveryForDeployment(a102, CONFIRMED)
    const second102 = await establishCodeDeliveryForDeployment(b102, CONFIRMED)

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
    for (const id of ids) await establishCodeDeliveryForDeployment(id, CONFIRMED)

    const sha103 = '4'.repeat(40)
    const next = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: sha103 })
    await establishCodeDeliveryForDeployment(next, CONFIRMED)

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

    await establishCodeDeliveryForDeployment(first, CONFIRMED)
    await establishCodeDeliveryForDeployment(second, CONFIRMED)

    expect((await getDeliveries(repositoryId))[1]).toEqual(expect.objectContaining({ base_sha: SHA_100 }))
  })

  it('creates one delivery when the same SHA is established concurrently', async () => {
    const repositoryId = await createRepository()
    const appA = await createApp('app-a')
    const appB = await createApp('app-b')
    const a = await createDeployment({ appId: appA, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    const b = await createDeployment({ appId: appB, appName: 'app-b', repositoryId, commitSha: SHA_101 })

    const results = await Promise.all([
      establishCodeDeliveryForDeployment(a, CONFIRMED),
      establishCodeDeliveryForDeployment(b, CONFIRMED),
    ])

    expect(results.map((result) => result.outcome).sort()).toEqual(['created', 'linked'])
    expect(await getDeliveries(repositoryId)).toHaveLength(1)
    expect(await getLinkedDeliveryId(a)).toBe(await getLinkedDeliveryId(b))
  })

  it('builds a single chain when different SHAs are established concurrently', async () => {
    const repositoryId = await createRepository()
    const appA = await createApp('app-a')
    const appB = await createApp('app-b')
    const a = await createDeployment({ appId: appA, appName: 'app-a', repositoryId, commitSha: SHA_101 })
    const b = await createDeployment({ appId: appB, appName: 'app-b', repositoryId, commitSha: SHA_102 })

    await Promise.all([
      establishCodeDeliveryForDeployment(a, CONFIRMED),
      establishCodeDeliveryForDeployment(b, CONFIRMED),
    ])

    const [first, second] = await getDeliveries(repositoryId)
    expect(first.base_sha).toBe(first.head_sha)
    expect(second.base_sha).toBe(first.head_sha)
  })

  it('does nothing when tracking is disabled', async () => {
    const repositoryId = await createRepository({ tracking: false })
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    expect(await establishCodeDeliveryForDeployment(deploymentId, CONFIRMED)).toEqual({
      outcome: 'skipped',
      reason: 'tracking_disabled',
    })
    expect(await getDeliveries(repositoryId)).toEqual([])
    expect(await getLinkedDeliveryId(deploymentId)).toBeNull()
  })

  it('skips deployments without repository identity', async () => {
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId: null, commitSha: SHA_100 })

    expect(await establishCodeDeliveryForDeployment(deploymentId, CONFIRMED)).toEqual({
      outcome: 'skipped',
      reason: 'missing_repository',
    })
  })

  it.each([null, 'abc123'])('skips deployments without a full commit SHA (%s)', async (commitSha) => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha })

    expect(await establishCodeDeliveryForDeployment(deploymentId, CONFIRMED)).toEqual({
      outcome: 'skipped',
      reason: 'missing_commit_sha',
    })
    expect(await getDeliveries(repositoryId)).toEqual([])
  })

  it.each(['ancestry_unknown', 'ancestry_diverged', 'source_unauthorized'] as const)(
    'does not create or link when grounds are unresolved (%s)',
    async (reason) => {
      const repositoryId = await createRepository()
      const appId = await createApp('app-a')
      const established = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
      const unresolved = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_101 })
      await establishCodeDeliveryForDeployment(established, CONFIRMED)

      expect(await establishCodeDeliveryForDeployment(unresolved, { confirmed: false, reason })).toEqual({
        outcome: 'unresolved',
        reason,
      })
      expect(await getDeliveries(repositoryId)).toHaveLength(1)
      expect(await getLinkedDeliveryId(unresolved)).toBeNull()
    },
  )

  it('does not let an unresolved deployment block a later confirmed deployment of the same SHA', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const first = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const second = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })

    await establishCodeDeliveryForDeployment(first, { confirmed: false, reason: 'source_unauthorized' })
    const result = await establishCodeDeliveryForDeployment(second, CONFIRMED)

    expect(result.outcome).toBe('created')
    expect(await getLinkedDeliveryId(first)).toBeNull()
    expect(await getLinkedDeliveryId(second)).not.toBeNull()
  })

  it('is idempotent for an already linked deployment', async () => {
    const repositoryId = await createRepository()
    const appId = await createApp('app-a')
    const deploymentId = await createDeployment({ appId, appName: 'app-a', repositoryId, commitSha: SHA_100 })
    const first = await establishCodeDeliveryForDeployment(deploymentId, CONFIRMED)

    const second = await establishCodeDeliveryForDeployment(deploymentId, CONFIRMED)

    expect(first.outcome).toBe('created')
    expect(second).toEqual({ outcome: 'already_linked', deliveryId: (first as { deliveryId: number }).deliveryId })
    expect(await getDeliveries(repositoryId)).toHaveLength(1)
  })

  it('keeps delivery chains separate per repository', async () => {
    const repositoryA = await createRepository({ githubRepoId: '901' })
    const repositoryB = await createRepository({ githubRepoId: '902' })
    const appId = await createApp('app-a')
    const a = await createDeployment({ appId, appName: 'app-a', repositoryId: repositoryA, commitSha: SHA_100 })
    const b = await createDeployment({ appId, appName: 'app-a', repositoryId: repositoryB, commitSha: SHA_101 })

    await establishCodeDeliveryForDeployment(a, CONFIRMED)
    await establishCodeDeliveryForDeployment(b, CONFIRMED)

    expect(await getDeliveries(repositoryB)).toEqual([
      expect.objectContaining({ base_sha: SHA_101, head_sha: SHA_101 }),
    ])
  })

  it('rejects unknown deployments', async () => {
    await expect(establishCodeDeliveryForDeployment(999999, CONFIRMED)).rejects.toThrow('was not found')
  })
})
