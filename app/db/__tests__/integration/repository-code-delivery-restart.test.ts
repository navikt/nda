import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { UserIdentity } from '~/lib/auth.server'
import {
  createRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDelivery,
} from '../../repository-code-deliveries.server'
import {
  getEarliestDeploymentAtForRepository,
  restartCodeDeliveryTracking,
} from '../../repository-code-delivery-restart.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

const SHA_1 = '1'.repeat(40)
const SHA_2 = '2'.repeat(40)
const SINCE = new Date('2024-01-01T00:00:00.000Z')

const adminActor: UserIdentity = {
  navIdent: 'Z990001',
  name: 'Glad Fjord',
  role: 'admin',
  isActualAdmin: true,
  adminSuppressed: false,
  entraGroups: [],
}

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
  const { rows: repoRows } = await pool.query<{ github_repo_id: string; github_repo_name: string }>(
    'SELECT github_repo_id, github_repo_name FROM repositories WHERE id = $1',
    [repositoryId],
  )
  await seedApplicationRepository(pool, {
    monitoredAppId: appId,
    githubOwner: 'navikt',
    githubRepo: repoRows[0].github_repo_name,
    githubRepoId: repoRows[0].github_repo_id,
  })
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
  it('preserves historical links and all tracking state when separate identities cannot be rebuilt', async () => {
    const repositoryId = await createRepository('2097')
    const { linked, unresolved } = await seedRegisteredState(repositoryId)
    await pool.query(
      `INSERT INTO repository_code_delivery_deployment_repositories (deployment_id, repository_id)
       VALUES ($1, $3), ($2, $3)`,
      [linked, unresolved, repositoryId],
    )
    await pool.query('UPDATE deployments SET repository_id = NULL WHERE id = ANY($1::int[])', [[linked, unresolved]])
    const before = await pool.query('SELECT * FROM deployments WHERE id = ANY($1::int[]) ORDER BY id', [
      [linked, unresolved],
    ])
    const trackingBefore = await pool.query('SELECT code_delivery_tracking_since FROM repositories WHERE id = $1', [
      repositoryId,
    ])

    expect(
      await restartCodeDeliveryTracking({
        repositoryId,
        since: SINCE,
        changedByNavIdent: adminActor.navIdent,
        actor: adminActor,
      }),
    ).toEqual({ ok: false, reason: 'has_separate_identities' })
    expect(
      (await pool.query('SELECT * FROM deployments WHERE id = ANY($1::int[]) ORDER BY id', [[linked, unresolved]]))
        .rows,
    ).toEqual(before.rows)
    expect(
      (await pool.query('SELECT code_delivery_tracking_since FROM repositories WHERE id = $1', [repositoryId])).rows,
    ).toEqual(trackingBefore.rows)
    expect(
      (await pool.query('SELECT id FROM repository_code_deliveries WHERE repository_id = $1', [repositoryId])).rows,
    ).toHaveLength(1)
    expect(
      (
        await pool.query('SELECT deployment_id FROM repository_code_delivery_unresolved WHERE deployment_id = $1', [
          unresolved,
        ])
      ).rows,
    ).toEqual([{ deployment_id: unresolved }])
    expect(
      (await pool.query('SELECT id FROM repo_config_audit_log WHERE repository_id = $1', [repositoryId])).rows,
    ).toEqual([])
  })

  it('preserves all tracking state when an immutable approval snapshot exists', async () => {
    const repositoryId = await createRepository('2099')
    await seedRegisteredState(repositoryId)
    const before = await pool.query('SELECT code_delivery_tracking_since FROM repositories WHERE id = $1', [
      repositoryId,
    ])
    await pool.query(
      `INSERT INTO repository_approval_snapshots
       (delivery_id, repository_id, base_sha, head_sha, schema_version, evaluator_version, evidence, evidence_hash)
       SELECT id, repository_id, base_sha, head_sha, 1, 1, '{}'::jsonb, 'test'
       FROM repository_code_deliveries WHERE repository_id = $1`,
      [repositoryId],
    )
    expect(
      await restartCodeDeliveryTracking({
        repositoryId,
        since: SINCE,
        changedByNavIdent: adminActor.navIdent,
        actor: adminActor,
      }),
    ).toEqual({ ok: false, reason: 'has_approval_snapshots' })
    expect(await counts(repositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
    const { rows } = await pool.query('SELECT code_delivery_tracking_since FROM repositories WHERE id = $1', [
      repositoryId,
    ])
    expect(rows[0].code_delivery_tracking_since).toEqual(before.rows[0].code_delivery_tracking_since)
    const audit = await pool.query('SELECT * FROM repo_config_audit_log WHERE repository_id = $1', [repositoryId])
    expect(audit.rows).toEqual([])
    const snapshots = await pool.query('SELECT id FROM repository_approval_snapshots WHERE repository_id = $1', [
      repositoryId,
    ])
    expect(snapshots.rows).toHaveLength(1)
  })

  it('waits for a concurrent snapshot and then refuses restart without deleting state', async () => {
    const repositoryId = await createRepository('2098')
    await seedRegisteredState(repositoryId)
    const client = await pool.connect()
    let restart: ReturnType<typeof restartCodeDeliveryTracking> | undefined
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM repository_code_deliveries WHERE repository_id = $1 FOR SHARE', [repositoryId])
      restart = restartCodeDeliveryTracking({
        repositoryId,
        since: SINCE,
        changedByNavIdent: adminActor.navIdent,
        actor: adminActor,
      })
      const deadline = Date.now() + 5000
      let blocked = false
      while (Date.now() < deadline) {
        const { rows } = await pool.query<{ blocked: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
             WHERE wait_event_type = 'Lock'
               AND query LIKE '%SELECT id FROM repository_code_deliveries%FOR UPDATE%') AS blocked`,
        )
        if (rows[0].blocked) {
          blocked = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await client.query(
        `INSERT INTO repository_approval_snapshots
           (delivery_id, repository_id, base_sha, head_sha, schema_version, evaluator_version, evidence, evidence_hash)
           SELECT id, repository_id, base_sha, head_sha, 1, 1, '{}'::jsonb, 'test'
           FROM repository_code_deliveries WHERE repository_id = $1`,
        [repositoryId],
      )
      await client.query('COMMIT')
      expect(await restart).toEqual({ ok: false, reason: 'has_approval_snapshots' })
      expect(blocked).toBe(true)
      expect(await counts(repositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
        await restart
      }
    }
  })

  it('clears registered state for the repository, moves since and writes an audit log entry', async () => {
    const repositoryId = await createRepository('2000')
    await seedRegisteredState(repositoryId)
    const result = await restartCodeDeliveryTracking({
      repositoryId,
      since: SINCE,
      changedByNavIdent: 'Z990001',
      changedByName: 'Glad Fjord',
      actor: adminActor,
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

    await restartCodeDeliveryTracking({ repositoryId, since: SINCE, changedByNavIdent: 'Z990001', actor: adminActor })

    expect(await counts(otherRepositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
  })

  it('does nothing when tracking is disabled', async () => {
    const repositoryId = await createRepository('2003', false)
    await seedRegisteredState(repositoryId)

    expect(
      await restartCodeDeliveryTracking({
        repositoryId,
        since: SINCE,
        changedByNavIdent: 'Z990001',
        actor: adminActor,
      }),
    ).toEqual({
      ok: false,
      reason: 'tracking_disabled',
    })
    expect(await counts(repositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
  })

  it('refuses a date that is not earlier than the current start date', async () => {
    const repositoryId = await createRepository('2004')
    await seedRegisteredState(repositoryId)
    await pool.query('UPDATE repositories SET code_delivery_tracking_since = $1 WHERE id = $2', [
      new Date('2023-01-01T00:00:00.000Z'),
      repositoryId,
    ])

    expect(
      await restartCodeDeliveryTracking({
        repositoryId,
        since: SINCE,
        changedByNavIdent: 'Z990001',
        actor: adminActor,
      }),
    ).toEqual({
      ok: false,
      reason: 'not_earlier',
    })
    expect(await counts(repositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
  })

  it('refuses an actor without admin access to the linked apps', async () => {
    const repositoryId = await createRepository('2005')
    await seedRegisteredState(repositoryId)
    const outsider: UserIdentity = {
      navIdent: 'Z999999',
      name: 'Utenforstaende Actor',
      role: 'user',
      isActualAdmin: false,
      adminSuppressed: false,
      entraGroups: [],
    }

    expect(
      await restartCodeDeliveryTracking({
        repositoryId,
        since: SINCE,
        changedByNavIdent: outsider.navIdent,
        actor: outsider,
      }),
    ).toEqual({ ok: false, reason: 'unauthorized' })
    expect(await counts(repositoryId)).toEqual({ deliveries: 1, unresolved: 1, linked: 1 })
  })

  it('refuses when the repository is not linked to an active app', async () => {
    const repositoryId = await createRepository('2006')

    expect(
      await restartCodeDeliveryTracking({
        repositoryId,
        since: SINCE,
        changedByNavIdent: 'Z990001',
        actor: adminActor,
      }),
    ).toEqual({
      ok: false,
      reason: 'repo_not_linked',
    })
  })

  it('reports an unknown repository', async () => {
    expect(
      await restartCodeDeliveryTracking({
        repositoryId: 999999,
        since: SINCE,
        changedByNavIdent: 'Z990001',
        actor: adminActor,
      }),
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
