import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDelivery,
} from '../../repository-code-deliveries.server'
import {
  getRepositoryCodeDeliveryOverview,
  listOpenUnresolvedCodeDeployments,
  listRepositoryCodeDeliveries,
} from '../../repository-code-delivery-overview.server'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

const SHA_1 = '1'.repeat(40)
const SHA_2 = '2'.repeat(40)
const SHA_3 = '3'.repeat(40)
const SHA_4 = '4'.repeat(40)

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  appIds.clear()
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

const appIds = new Map<string, number>()

async function createDeployment(appName: string, repositoryId: number, commitSha: string) {
  let appId = appIds.get(appName)
  if (appId === undefined) {
    appId = await seedApp(pool, { teamSlug: 'team-fjord', appName, environment: 'prod-gcp' })
    appIds.set(appName, appId)
  }
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

async function markUnresolved(deploymentId: number, reason: string, resolved = false) {
  await pool.query(
    `INSERT INTO repository_code_delivery_unresolved (deployment_id, reason, resolved_at)
     VALUES ($1, $2, CASE WHEN $3::boolean THEN now() ELSE NULL END)`,
    [deploymentId, reason, resolved],
  )
}

describe('repository code delivery overview', () => {
  it('returns an empty overview for a repository without deliveries', async () => {
    const repositoryId = await createRepository('1000')

    expect(await getRepositoryCodeDeliveryOverview(repositoryId)).toEqual({
      deliveryCount: 0,
      linkedDeploymentCount: 0,
      awaitingDeploymentCount: 0,
      unresolvedByReason: {},
    })
    expect(await listRepositoryCodeDeliveries(repositoryId, { limit: 10, offset: 0 })).toEqual([])
    expect(await listOpenUnresolvedCodeDeployments(repositoryId, 10)).toEqual([])
  })

  it('summarises deliveries, linked, awaiting and open unresolved deployments', async () => {
    const repositoryId = await createRepository('1001')
    const linked = await createDeployment('app-a', repositoryId, SHA_1)
    const awaiting = await createDeployment('app-b', repositoryId, SHA_2)
    const behind = await createDeployment('app-c', repositoryId, SHA_3)
    const resolved = await createDeployment('app-d', repositoryId, SHA_4)
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_1 })
    await linkDeploymentToRepositoryCodeDelivery(linked, delivery.id)
    await markUnresolved(behind, 'ancestry_behind')
    await markUnresolved(resolved, 'source_unknown', true)
    await pool.query("UPDATE deployments SET created_at = now() + interval '1 hour' WHERE id = ANY($1::int[])", [
      [awaiting, behind, resolved],
    ])

    expect(await getRepositoryCodeDeliveryOverview(repositoryId)).toEqual({
      deliveryCount: 1,
      linkedDeploymentCount: 1,
      awaitingDeploymentCount: 2,
      unresolvedByReason: { ancestry_behind: 1 },
    })
  })

  it('lists deliveries newest first with anchor flag, deployment count and distinct apps', async () => {
    const repositoryId = await createRepository('1002')
    const first = await createDeployment('app-a', repositoryId, SHA_1)
    const second = await createDeployment('app-b', repositoryId, SHA_2)
    const third = await createDeployment('app-a', repositoryId, SHA_2)
    const anchor = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_1 })
    const next = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_2 })
    await linkDeploymentToRepositoryCodeDelivery(first, anchor.id)
    await linkDeploymentToRepositoryCodeDelivery(second, next.id)
    await linkDeploymentToRepositoryCodeDelivery(third, next.id)

    const deliveries = await listRepositoryCodeDeliveries(repositoryId, { limit: 10, offset: 0 })
    expect(
      deliveries.map((d) => ({ id: d.id, anchor: d.is_anchor, count: d.deployment_count, apps: d.app_names })),
    ).toEqual([
      { id: next.id, anchor: false, count: 2, apps: ['app-a', 'app-b'] },
      { id: anchor.id, anchor: true, count: 1, apps: ['app-a'] },
    ])

    const page = await listRepositoryCodeDeliveries(repositoryId, { limit: 1, offset: 1 })
    expect(page.map((d) => d.id)).toEqual([anchor.id])
  })

  it('lists only open unresolved deployments for the requested repository', async () => {
    const repositoryId = await createRepository('1003')
    const otherRepositoryId = await createRepository('1004')
    const open = await createDeployment('app-a', repositoryId, SHA_1)
    const resolved = await createDeployment('app-b', repositoryId, SHA_2)
    const other = await createDeployment('app-c', otherRepositoryId, SHA_3)
    await markUnresolved(open, 'ancestry_diverged')
    await markUnresolved(resolved, 'source_unknown', true)
    await markUnresolved(other, 'ancestry_diverged')

    await pool.query(
      'UPDATE deployments SET detected_github_owner = $1, detected_github_repo_name = $2 WHERE id = $3',
      ['navikt', 'old-name', open],
    )

    const unresolved = await listOpenUnresolvedCodeDeployments(repositoryId, 10)
    expect(
      unresolved.map((item) => ({
        id: item.deployment_id,
        reason: item.reason,
        owner: item.detected_github_owner,
        repo: item.detected_github_repo_name,
      })),
    ).toEqual([{ id: open, reason: 'ancestry_diverged', owner: 'navikt', repo: 'old-name' }])
    expect(await getRepositoryCodeDeliveryOverview(otherRepositoryId)).toMatchObject({
      unresolvedByReason: { ancestry_diverged: 1 },
    })
  })
})
