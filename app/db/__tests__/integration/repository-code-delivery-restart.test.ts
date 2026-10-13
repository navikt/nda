import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDelivery,
} from '../../repository-code-deliveries.server'
import {
  getEarliestDeploymentAtForRepository,
  restartCodeDeliveryTracking,
} from '../../repository-code-delivery-restart.server'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

const SHA_1 = '1'.repeat(40)
const SHA_2 = '2'.repeat(40)
const SINCE = new Date('2024-01-01T00:00:00.000Z')

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

async function createRepository(githubRepoId: string, tracking = true) {
  const repositoryId = await seedRepository(pool, {
    githubRepoId,
    githubOwner: 'navikt',
    githubRepoName: `repo-${githubRepoId}`,
  })
  await pool.query('UPDATE repositories SET code_delivery_tracking = $1 WHERE id = $2', [tracking, repositoryId])
  return repositoryId
}

async function createDeployment(appId: number, appName: string, repositoryId: number, commitSha: string) {
  const deploymentId = await seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-fjord',
    appName,
    environment: 'prod-gcp',
    commitSha,
  })
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, deploymentId])
  return deploymentId
}

async function seedRegisteredState(repositoryId: number) {
  const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: `app-${repositoryId}`, environment: 'prod-gcp' })
  const linked = await createDeployment(appId, `app-${repositoryId}`, repositoryId, SHA_1)
  const unresolved = await createDeployment(appId, `app-${repositoryId}`, repositoryId, SHA_2)
  const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_1 })
  await linkDeploymentToRepositoryCodeDelivery(linked, delivery.id)
  await pool.query(
    `INSERT INTO repository_code_delivery_unresolved (deployment_id, reason) VALUES ($1, 'ancestry_behind')`,
    [unresolved],
  )
  return { linked, unresolved }
}

async function counts(repositoryId: number) {
  const [deliveries, unresolved, linked] = await Promise.all([
    pool.query('SELECT count(*)::int AS n FROM repository_code_deliveries WHERE repository_id = $1', [repositoryId]),
    pool.query(
      `SELECT count(*)::int AS n FROM repository_code_delivery_unresolved
       WHERE deployment_id IN (SELECT id FROM deployments WHERE repository_id = $1)`,
      [repositoryId],
    ),
    pool.query(
      'SELECT count(*)::int AS n FROM deployments WHERE repository_id = $1 AND repository_code_delivery_id IS NOT NULL',
      [repositoryId],
    ),
  ])
  return { deliveries: deliveries.rows[0].n, unresolved: unresolved.rows[0].n, linked: linked.rows[0].n }
}

describe('restartCodeDeliveryTracking', () => {
  it('clears registered state for the repository, moves since and writes an audit log entry', async () => {
    const repositoryId = await createRepository('2000')
    await seedRegisteredState(repositoryId)

    const result = await restartCodeDeliveryTracking({
      repositoryId,
      since: SINCE,
      changedByNavIdent: 'Z990001',
      changedByName: 'Glad Fjord',
    })

    expect(result).toEqual({
      ok: true,
      since: SINCE,
      deletedDeliveries: 1,
      unlinkedDeployments: 1,
      clearedUnresolved: 1,
    })
    expect(await counts(repositoryId)).toEqual({ deliveries: 0, unresolved: 0, linked: 0 })
    const { rows } = await pool.query<{ code_delivery_tracking_since: Date }>(
      'SELECT code_delivery_tracking_since FROM repositories WHERE id = $1',
      [repositoryId],
    )
    expect(rows[0].code_delivery_tracking_since).toEqual(SINCE)

    const log = await pool.query(
      'SELECT changed_by_nav_ident, new_value FROM repo_config_audit_log WHERE repository_id = $1 AND setting_key = $2',
      [repositoryId, 'code_delivery_tracking_restart'],
    )
    expect(log.rows).toEqual([
      {
        changed_by_nav_ident: 'Z990001',
        new_value: {
          since: SINCE.toISOString(),
          deleted_deliveries: 1,
          unlinked_deployments: 1,
          cleared_unresolved: 1,
        },
      },
    ])
  })

  it('leaves other repositories untouched', async () => {
    const repositoryId = await createRepository('2001')
    const otherRepositoryId = await createRepository('2002')
    await seedRegisteredState(repositoryId)
    await seedRegisteredState(otherRepositoryId)

    await restartCodeDeliveryTracking({ repositoryId, since: SINCE, changedByNavIdent: 'Z990001' })

    expect(await counts(otherRepositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
  })

  it('does nothing when tracking is disabled', async () => {
    const repositoryId = await createRepository('2003', false)
    await seedRegisteredState(repositoryId)

    expect(await restartCodeDeliveryTracking({ repositoryId, since: SINCE, changedByNavIdent: 'Z990001' })).toEqual({
      ok: false,
      reason: 'tracking_disabled',
    })
    expect(await counts(repositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
  })

  it('reports an unknown repository', async () => {
    expect(
      await restartCodeDeliveryTracking({ repositoryId: 999999, since: SINCE, changedByNavIdent: 'Z990001' }),
    ).toEqual({ ok: false, reason: 'repo_not_found' })
  })

  it('returns the earliest deployment time for the repository', async () => {
    const repositoryId = await createRepository('2004')
    expect(await getEarliestDeploymentAtForRepository(repositoryId)).toBeNull()

    const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'app-earliest', environment: 'prod-gcp' })
    const deploymentId = await createDeployment(appId, 'app-earliest', repositoryId, SHA_1)
    await pool.query('UPDATE deployments SET created_at = $1 WHERE id = $2', [SINCE, deploymentId])

    expect(await getEarliestDeploymentAtForRepository(repositoryId)).toEqual(SINCE)
  })
})
