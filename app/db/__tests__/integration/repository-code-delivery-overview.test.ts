import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDelivery,
} from '../../repository-code-deliveries.server'
import {
  getRepositoryCodeDeliveryExportData,
  getRepositoryCodeDeliveryOverview,
  getRepositoryHistoryReadiness,
  listOpenUnresolvedCodeDeployments,
  listRepositoryCodeDeliveries,
  listRepositoryCodeDeliveryAncestryEvidence,
  listRepositoryCodeDeliveryExportRows,
} from '../../repository-code-delivery-overview.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

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

  it('reports history sync and deployment identity coverage for active and historical app links', async () => {
    const repositoryId = await createRepository('1006')
    const otherRepositoryId = await createRepository('1007')
    const currentApp = await seedApp(pool, {
      teamSlug: 'team-fjord',
      appName: 'current-app',
      environment: 'prod-gcp',
    })
    const historicalApp = await seedApp(pool, {
      teamSlug: 'team-fjord',
      appName: 'historical-app',
      environment: 'prod-gcp',
      isActive: false,
    })
    const pendingApp = await seedApp(pool, {
      teamSlug: 'team-fjord',
      appName: 'pending-app',
      environment: 'prod-gcp',
    })
    const unlinkedApp = await seedApp(pool, {
      teamSlug: 'team-fjord',
      appName: 'unlinked-app',
      environment: 'prod-gcp',
    })

    await seedApplicationRepository(pool, {
      monitoredAppId: currentApp,
      githubOwner: 'navikt',
      githubRepo: 'repo-1006',
      githubRepoId: '1006',
      status: 'active',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: historicalApp,
      githubOwner: 'navikt',
      githubRepo: 'repo-1006',
      githubRepoId: '1006',
      status: 'historical',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: pendingApp,
      githubOwner: 'navikt',
      githubRepo: 'repo-1006',
      githubRepoId: '1006',
      status: 'pending_approval',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: unlinkedApp,
      githubOwner: 'navikt',
      githubRepo: 'repo-1007',
      githubRepoId: '1007',
      status: 'active',
    })

    await pool.query('UPDATE monitored_applications SET initial_nais_history_synced_at = $1 WHERE id = $2', [
      new Date('2026-10-01T08:00:00Z'),
      currentApp,
    ])

    const currentLinked = await seedDeployment(pool, {
      monitoredAppId: currentApp,
      teamSlug: 'team-fjord',
      appName: 'current-app',
      environment: 'prod-gcp',
      commitSha: SHA_1,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, currentLinked])
    const linkedToOtherRepository = await seedDeployment(pool, {
      monitoredAppId: currentApp,
      teamSlug: 'team-fjord',
      appName: 'current-app',
      environment: 'prod-gcp',
      commitSha: SHA_4,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [
      otherRepositoryId,
      linkedToOtherRepository,
    ])
    await seedDeployment(pool, {
      monitoredAppId: currentApp,
      teamSlug: 'team-fjord',
      appName: 'current-app',
      environment: 'prod-gcp',
      commitSha: SHA_2,
    })
    const historicalLinked = await seedDeployment(pool, {
      monitoredAppId: historicalApp,
      teamSlug: 'team-fjord',
      appName: 'historical-app',
      environment: 'prod-gcp',
      commitSha: 'short-sha',
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, historicalLinked])
    const unlinkedRepositoryDeployment = await seedDeployment(pool, {
      monitoredAppId: unlinkedApp,
      teamSlug: 'team-fjord',
      appName: 'unlinked-app',
      environment: 'prod-gcp',
      commitSha: SHA_3,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [
      repositoryId,
      unlinkedRepositoryDeployment,
    ])

    expect(await getRepositoryHistoryReadiness(repositoryId)).toEqual({
      applications: [
        expect.objectContaining({
          app_name: 'current-app',
          is_active: true,
          initial_nais_history_synced_at: new Date('2026-10-01T08:00:00Z'),
          deployment_count: 3,
          repository_deployment_count: 1,
          unassigned_deployment_count: 1,
          other_repository_deployment_count: 1,
          repository_deployments_missing_sha: 0,
        }),
        expect.objectContaining({
          app_name: 'historical-app',
          is_active: false,
          initial_nais_history_synced_at: null,
          deployment_count: 1,
          repository_deployment_count: 1,
          unassigned_deployment_count: 0,
          other_repository_deployment_count: 0,
          repository_deployments_missing_sha: 1,
        }),
      ],
      repositoryDeploymentCount: 3,
      repositoryDeploymentsMissingShaCount: 1,
      repositoryDeploymentsWithoutKnownAppLinkCount: 1,
    })
  })

  it('exports all repository deployments in deployment order with delivery and unresolved evidence', async () => {
    const repositoryId = await createRepository('1010')
    const linkedDeployment = await createDeployment('export-app', repositoryId, SHA_1)
    const unresolvedDeployment = await createDeployment('export-app', repositoryId, SHA_2)
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_1 })
    await linkDeploymentToRepositoryCodeDelivery(linkedDeployment, delivery.id)
    await markUnresolved(unresolvedDeployment, 'ancestry_behind')
    await pool.query(
      `UPDATE deployments SET created_at = CASE id
         WHEN $1 THEN '2026-10-13T10:00:00Z'::timestamptz
         WHEN $2 THEN '2026-10-14T10:00:00Z'::timestamptz
       END
       WHERE id = ANY($3::int[])`,
      [linkedDeployment, unresolvedDeployment, [linkedDeployment, unresolvedDeployment]],
    )

    const rows = await listRepositoryCodeDeliveryExportRows(repositoryId)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      deployment_id: linkedDeployment,
      deployed_sha: SHA_1,
      delivery_id: delivery.id,
      delivery_base_sha: SHA_1,
      delivery_head_sha: SHA_1,
    })
    expect(rows[0].delivery_first_deployed_at).toEqual(new Date('2026-10-13T10:00:00Z'))
    expect(rows[1]).toMatchObject({
      deployment_id: unresolvedDeployment,
      deployed_sha: SHA_2,
      unresolved_reason: 'ancestry_behind',
      unresolved_resolved_at: null,
    })
    expect(rows[1].deployed_at).toEqual(new Date('2026-10-14T10:00:00Z'))
  })

  it('includes registered deliveries without linked deployments in the consistent export snapshot', async () => {
    const repositoryId = await createRepository('1012')
    const deployedDelivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_1 })
    const unlinkedDelivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_2 })
    const deployment = await createDeployment('delivery-only-export-app', repositoryId, SHA_1)
    await linkDeploymentToRepositoryCodeDelivery(deployment, deployedDelivery.id)

    const exportData = await getRepositoryCodeDeliveryExportData(repositoryId)

    expect(exportData.deliveries).toHaveLength(2)
    expect(exportData.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: deployedDelivery.id,
          base_sha: SHA_1,
          head_sha: SHA_1,
          deployment_count: 1,
        }),
        expect.objectContaining({
          id: unlinkedDelivery.id,
          base_sha: SHA_1,
          head_sha: SHA_2,
          first_deployed_at: null,
          deployment_count: 0,
        }),
      ]),
    )
  })

  it('includes matching compare snapshots as candidate ancestry evidence without asserting retry linkage', async () => {
    const repositoryId = await createRepository('1011')
    const deliveryDeployment = await createDeployment('compare-evidence-app', repositoryId, SHA_1)
    const unresolvedDeployment = await createDeployment('compare-evidence-app', repositoryId, SHA_2)
    const divergedDeployment = await createDeployment('compare-evidence-app', repositoryId, SHA_3)
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_1 })
    await linkDeploymentToRepositoryCodeDelivery(deliveryDeployment, delivery.id)
    await markUnresolved(unresolvedDeployment, 'ancestry_behind')
    await markUnresolved(divergedDeployment, 'ancestry_diverged')
    await pool.query(
      `UPDATE deployments SET created_at = '2026-10-14T10:00:00Z'::timestamptz
       WHERE id = ANY($1::int[])`,
      [[unresolvedDeployment, divergedDeployment]],
    )
    await pool.query(
      `UPDATE repository_code_delivery_unresolved
       SET created_at = '2026-10-14T10:05:00Z'::timestamptz,
           updated_at = '2026-10-14T10:10:00Z'::timestamptz
       WHERE deployment_id = ANY($1::int[])`,
      [[unresolvedDeployment, divergedDeployment]],
    )
    await pool.query(
      `INSERT INTO github_compare_raw_snapshots (
         github_repo_id, owner, repo, base_sha, head_sha, api_version, data, fetched_at
       ) VALUES (
         '1011', 'navikt', 'repo-1011', $1, $2, '2022-11-28',
         $3::jsonb, '2026-10-14T10:07:00Z'::timestamptz
       )`,
      [
        SHA_1,
        SHA_2,
        JSON.stringify({
          status: 'behind',
          ahead_by: 0,
          behind_by: 2,
          total_commits: 2,
          commits: [{ sha: SHA_3 }, { sha: SHA_4 }],
        }),
      ],
    )
    await pool.query(
      `INSERT INTO github_compare_raw_snapshots (
         github_repo_id, owner, repo, base_sha, head_sha, api_version, data, fetched_at
       ) VALUES (
         '1011', 'navikt', 'repo-1011', $1, $2, '2022-11-28',
         $3::jsonb, '2026-10-14T10:08:00Z'::timestamptz
       )`,
      [
        SHA_1,
        SHA_3,
        JSON.stringify({
          status: 'diverged',
          ahead_by: 1,
          behind_by: 1,
          total_commits: 2,
          commits: [{ sha: SHA_3 }, { sha: SHA_4 }],
        }),
      ],
    )

    const evidence = await listRepositoryCodeDeliveryAncestryEvidence(repositoryId)

    expect(evidence).toHaveLength(2)
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unresolved_deployment_id: unresolvedDeployment,
          unresolved_deployed_sha: SHA_2,
          unresolved_reason: 'ancestry_behind',
          delivery_id: delivery.id,
          delivery_head_sha: SHA_1,
          compare_status: 'behind',
          compare_ahead_by: 0,
          compare_behind_by: 2,
          compare_total_commits: 2,
          compare_commit_shas: [SHA_3, SHA_4],
          compare_api_version: '2022-11-28',
          fetched_between_observations: true,
          compare_fetched_at: new Date('2026-10-14T10:07:00Z'),
        }),
        expect.objectContaining({
          unresolved_deployment_id: divergedDeployment,
          unresolved_deployed_sha: SHA_3,
          unresolved_reason: 'ancestry_diverged',
          delivery_id: delivery.id,
          delivery_head_sha: SHA_1,
          compare_status: 'diverged',
          compare_ahead_by: 1,
          compare_behind_by: 1,
          compare_total_commits: 2,
          compare_commit_shas: [SHA_3, SHA_4],
          compare_api_version: '2022-11-28',
          fetched_between_observations: true,
          compare_fetched_at: new Date('2026-10-14T10:08:00Z'),
        }),
      ]),
    )
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

  it('does not count deployments as awaiting assessment while tracking is disabled', async () => {
    const repositoryId = await createRepository('1005')
    const deploymentId = await createDeployment('app-a', repositoryId, SHA_1)
    await pool.query("UPDATE deployments SET created_at = now() + interval '1 hour' WHERE id = $1", [deploymentId])
    expect((await getRepositoryCodeDeliveryOverview(repositoryId)).awaitingDeploymentCount).toBe(1)

    await pool.query('UPDATE repositories SET code_delivery_tracking = false WHERE id = $1', [repositoryId])

    expect((await getRepositoryCodeDeliveryOverview(repositoryId)).awaitingDeploymentCount).toBe(0)
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
    await pool.query(
      `UPDATE deployments
       SET created_at = CASE id
         WHEN $1 THEN '2026-10-01T10:00:00Z'::timestamptz
         WHEN $2 THEN '2026-10-02T10:00:00Z'::timestamptz
         WHEN $3 THEN '2026-10-03T10:00:00Z'::timestamptz
       END
       WHERE id = ANY($4::int[])`,
      [first, second, third, [first, second, third]],
    )

    const deliveries = await listRepositoryCodeDeliveries(repositoryId, { limit: 10, offset: 0 })
    expect(
      deliveries.map((d) => ({
        id: d.id,
        anchor: d.is_anchor,
        firstDeployedAt: d.first_deployed_at?.toISOString(),
        count: d.deployment_count,
        apps: d.app_names,
      })),
    ).toEqual([
      {
        id: next.id,
        anchor: false,
        firstDeployedAt: '2026-10-02T10:00:00.000Z',
        count: 2,
        apps: ['app-a', 'app-b'],
      },
      {
        id: anchor.id,
        anchor: true,
        firstDeployedAt: '2026-10-01T10:00:00.000Z',
        count: 1,
        apps: ['app-a'],
      },
    ])

    const page = await listRepositoryCodeDeliveries(repositoryId, { limit: 1, offset: 1 })
    expect(page.map((d) => d.id)).toEqual([anchor.id])

    const firstDeployedAscending = await listRepositoryCodeDeliveries(repositoryId, {
      limit: 10,
      offset: 0,
      sort: { orderBy: 'first_deployed_at', direction: 'ascending' },
    })
    expect(firstDeployedAscending.map((delivery) => delivery.id)).toEqual([anchor.id, next.id])

    const firstDeployedDescending = await listRepositoryCodeDeliveries(repositoryId, {
      limit: 10,
      offset: 0,
      sort: { orderBy: 'first_deployed_at', direction: 'descending' },
    })
    expect(firstDeployedDescending.map((delivery) => delivery.id)).toEqual([next.id, anchor.id])
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
