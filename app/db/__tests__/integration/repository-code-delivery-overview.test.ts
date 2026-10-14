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

  it('exports a bounded unresolved-deployment window with referenced GitHub snapshots', async () => {
    const repositoryId = await createRepository('1012')
    await pool.query(
      `UPDATE repositories
       SET default_branch = 'release', audit_start_year = 2025,
           code_delivery_tracking_since = '2026-09-15T00:00:00Z'
       WHERE id = $1`,
      [repositoryId],
    )
    const neighborDates = [
      '2026-10-14T09:00:00Z',
      '2026-10-14T10:00:00Z',
      '2026-10-14T11:00:00Z',
      '2026-10-14T13:00:00Z',
      '2026-10-14T14:00:00Z',
      '2026-10-14T15:00:00Z',
      '2026-10-14T16:00:00Z',
    ]
    const neighbors: Array<{ deliveryId: number; deploymentId: number }> = []

    for (const [index, deployedAt] of neighborDates.entries()) {
      const sha = String(index + 1).repeat(40)
      const deploymentId = await createDeployment('window-export-app', repositoryId, sha)
      const delivery = await createRepositoryCodeDelivery({
        repositoryId,
        baseSha: String(index + 1).repeat(40),
        headSha: String(index + 1).repeat(40),
      })
      await linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)
      await pool.query('UPDATE deployments SET created_at = $1 WHERE id = $2', [deployedAt, deploymentId])
      neighbors.push({ deliveryId: delivery.id, deploymentId })
    }

    const unresolvedDeploymentId = await createDeployment('window-export-app', repositoryId, SHA_4)
    await markUnresolved(unresolvedDeploymentId, 'ancestry_behind')
    await pool.query(`UPDATE deployments SET created_at = '2026-10-14T13:00:00Z', trigger_url = $1 WHERE id = $2`, [
      'https://github.com/navikt/repo-1012/actions/runs/12345?check_suite_focus=true#summary',
      unresolvedDeploymentId,
    ])
    const sameTimestampDeploymentId = await createDeployment('window-export-app', repositoryId, '8'.repeat(40))
    const sameTimestampDelivery = await createRepositoryCodeDelivery({
      repositoryId,
      baseSha: '8'.repeat(40),
      headSha: '8'.repeat(40),
    })
    await linkDeploymentToRepositoryCodeDelivery(sameTimestampDeploymentId, sameTimestampDelivery.id)
    await pool.query(`UPDATE deployments SET created_at = '2026-10-14T13:00:00Z', trigger_url = $1 WHERE id = $2`, [
      'https://github.com/else/repo-1012/actions/runs/12345',
      sameTimestampDeploymentId,
    ])
    await pool.query(`UPDATE deployments SET trigger_url = $1 WHERE id = $2`, [
      'https://malicious.example/navikt/repo-1012/actions/runs/12345',
      neighbors[2].deploymentId,
    ])
    await pool.query(`UPDATE deployments SET trigger_url = $1 WHERE id = $2`, [
      'https://github.com/old-navikt/old-repo-1012/actions/runs/54321',
      neighbors[4].deploymentId,
    ])
    await pool.query(
      `INSERT INTO repository_name_history (repository_id, github_owner, github_repo_name)
       VALUES ($1, 'old-navikt', 'old-repo-1012')`,
      [repositoryId],
    )
    await pool.query(`UPDATE deployments SET trigger_url = $1 WHERE id = $2`, [
      'https://github.com/navikt/another-repo/actions/runs/12345',
      neighbors[3].deploymentId,
    ])
    await pool.query(
      `INSERT INTO verification_runs
         (deployment_id, schema_version, pr_snapshot_ids, commit_snapshot_ids, result, status, run_at)
       VALUES ($1, 3, ARRAY[1001], ARRAY[2001], '{"status":"approved"}', 'approved', '2026-10-14T13:01:00Z')`,
      [unresolvedDeploymentId],
    )
    await pool.query(
      `INSERT INTO github_pr_snapshots
         (id, owner, repo, pr_number, data_type, data)
       VALUES (1001, 'navikt', 'repo-1012', 82, 'reviews', '{"reviews":[{"state":"APPROVED"}]}')`,
    )
    await pool.query(
      `INSERT INTO github_commit_snapshots
         (id, owner, repo, sha, data_type, data)
       VALUES (2001, 'navikt', 'repo-1012', $1, 'prs', '{"pull_requests":[{"number":82}]}')`,
      [SHA_4],
    )
    await pool.query(
      `INSERT INTO github_workflow_runs_raw_snapshots
         (github_repo_id, owner, repo, run_id, api_version, data)
       VALUES
         ('1012', 'navikt', 'repo-1012', 12345, '2022-11-28', '{"event":"push","head_sha":"${SHA_4}"}'),
         ('1012', 'old-navikt', 'old-repo-1012', 54321, '2022-11-28', '{"event":"push","head_sha":"${SHA_3}"}')`,
    )
    await pool.query(
      `INSERT INTO repo_config_audit_log
         (repository_id, changed_by_nav_ident, setting_key, old_value, new_value)
       VALUES ($1, 'Z990001', 'implicit_approval_mode', '{"implicit_approval_mode":"off"}',
               '{"implicit_approval_mode":"dependabot_only"}')`,
      [repositoryId],
    )

    const exportData = await getRepositoryCodeDeliveryExportData(repositoryId, unresolvedDeploymentId)

    expect(exportData.repositoryMetadata).toEqual({
      github_repo_id: '1012',
      github_owner: 'navikt',
      github_repo_name: 'repo-1012',
      default_branch: 'release',
      code_delivery_tracking_since: new Date('2026-09-15T00:00:00Z'),
      audit_start_year: 2025,
    })
    expect(exportData.diagnosticTargets).toMatchObject([
      {
        unresolvedDeploymentId,
        nearbyDeliveryCountPerSide: 2,
        includedDeliveryIds: [
          neighbors[2].deliveryId,
          neighbors[3].deliveryId,
          sameTimestampDelivery.id,
          neighbors[4].deliveryId,
        ],
        includedDeploymentIds: [
          neighbors[2].deploymentId,
          neighbors[3].deploymentId,
          unresolvedDeploymentId,
          sameTimestampDeploymentId,
          neighbors[4].deploymentId,
        ],
      },
    ])
    expect(exportData.deliveries).toHaveLength(4)
    expect(exportData.deliveries.find((delivery) => delivery.id === neighbors[2].deliveryId)?.contexts).toEqual([
      { unresolvedDeploymentId, relativePosition: 'before' },
    ])
    expect(exportData.deliveries.find((delivery) => delivery.id === neighbors[3].deliveryId)?.contexts).toEqual([
      { unresolvedDeploymentId, relativePosition: 'before' },
    ])
    expect(exportData.deliveries.find((delivery) => delivery.id === sameTimestampDelivery.id)?.contexts).toEqual([
      { unresolvedDeploymentId, relativePosition: 'after' },
    ])
    expect(exportData.deployments).toHaveLength(5)
    expect(exportData.verificationRuns).toHaveLength(1)
    expect(exportData.prSnapshots).toEqual([expect.objectContaining({ id: 1001, data_type: 'reviews' })])
    expect(exportData.commitSnapshots).toEqual([expect.objectContaining({ id: 2001, sha: SHA_4 })])
    expect(exportData.workflowRunSnapshots).toEqual([
      expect.objectContaining({
        run_id: '12345',
        github_repo_id: '1012',
        data: { event: 'push', head_sha: SHA_4 },
      }),
      expect.objectContaining({
        run_id: '54321',
        github_repo_id: '1012',
        owner: 'old-navikt',
        repo: 'old-repo-1012',
        data: { event: 'push', head_sha: SHA_3 },
      }),
    ])
    expect(exportData.repositoryConfigAuditLog).toHaveLength(1)

    const automaticExportData = await getRepositoryCodeDeliveryExportData(repositoryId)
    expect(automaticExportData.diagnosticTargets).toEqual(exportData.diagnosticTargets)
    expect(automaticExportData.verificationRuns).toHaveLength(1)
    expect(
      (await getRepositoryCodeDeliveryExportData(repositoryId, neighbors[0].deploymentId)).diagnosticTargets,
    ).toEqual([])
  })

  it('exports all verification runs and repository configuration changes for only this repository', async () => {
    const repositoryId = await createRepository('1013')
    const otherRepositoryId = await createRepository('1014')
    const deploymentId = await createDeployment('audit-evidence-app', repositoryId, SHA_1)
    const otherDeploymentId = await createDeployment('other-audit-app', otherRepositoryId, SHA_2)
    await markUnresolved(deploymentId, 'ancestry_behind')
    await pool.query(`UPDATE repositories SET implicit_approval_mode = 'all' WHERE id = $1`, [repositoryId])
    await pool.query(
      `INSERT INTO verification_runs
         (deployment_id, schema_version, pr_snapshot_ids, commit_snapshot_ids, result, status, run_at)
       VALUES
         ($1, 3, ARRAY[11], ARRAY[21, 22], $2::jsonb, 'unverified_commits', '2026-10-13T10:00:00Z'),
         ($1, 3, ARRAY[12], ARRAY[23], $3::jsonb, 'approved', '2026-10-14T10:00:00Z'),
         ($4, 3, '{}', '{}', $5::jsonb, 'approved', '2026-10-14T11:00:00Z')`,
      [
        deploymentId,
        JSON.stringify({ status: 'unverified_commits', unverifiedCommits: [{ prNumber: 82 }] }),
        JSON.stringify({ status: 'approved', unverifiedCommits: [] }),
        otherDeploymentId,
        JSON.stringify({ status: 'approved' }),
      ],
    )
    await pool.query(
      `INSERT INTO repo_config_audit_log
         (repository_id, changed_by_nav_ident, changed_by_name, setting_key, old_value, new_value, change_reason, created_at)
       VALUES
         ($1, 'Z990001', 'Glad Fjord', 'implicit_approval_mode', '{"implicit_approval_mode":"off"}',
          '{"implicit_approval_mode":"dependabot_only"}', 'Initial configuration', '2026-10-13T09:00:00Z'),
         ($1, 'Z990002', 'Rask Elv', 'implicit_approval_mode', '{"implicit_approval_mode":"dependabot_only"}',
          '{"implicit_approval_mode":"all"}', 'Changed mode', '2026-10-14T09:00:00Z'),
         ($2, 'Z990003', 'Trygg Dal', 'implicit_approval_mode', '{"implicit_approval_mode":"off"}',
          '{"implicit_approval_mode":"all"}', 'Other repository', '2026-10-14T12:00:00Z')`,
      [repositoryId, otherRepositoryId],
    )

    const exportData = await getRepositoryCodeDeliveryExportData(repositoryId, deploymentId)

    expect(exportData?.verificationRuns).toHaveLength(2)
    expect(exportData?.verificationRuns).toEqual([
      expect.objectContaining({
        deployment_id: deploymentId,
        status: 'unverified_commits',
        pr_snapshot_ids: [11],
        commit_snapshot_ids: [21, 22],
      }),
      expect.objectContaining({
        deployment_id: deploymentId,
        status: 'approved',
        pr_snapshot_ids: [12],
        commit_snapshot_ids: [23],
      }),
    ])
    expect(exportData?.repositoryConfigAuditLog).toHaveLength(2)
    expect(exportData?.repositoryConfigAuditLog).toEqual([
      expect.objectContaining({
        setting_key: 'implicit_approval_mode',
        old_value: { implicit_approval_mode: 'off' },
        new_value: { implicit_approval_mode: 'dependabot_only' },
        changed_by_nav_ident: 'Z990001',
      }),
      expect.objectContaining({
        setting_key: 'implicit_approval_mode',
        old_value: { implicit_approval_mode: 'dependabot_only' },
        new_value: { implicit_approval_mode: 'all' },
        changed_by_nav_ident: 'Z990002',
      }),
    ])
    expect(exportData?.implicitApprovalMode).toBe('all')
  })

  it('includes matching compare snapshots as candidate ancestry evidence without asserting retry linkage', async () => {
    const repositoryId = await createRepository('1011')
    const deliveryDeployment = await createDeployment('compare-evidence-app', repositoryId, SHA_1)
    const unresolvedDeployment = await createDeployment('compare-evidence-app', repositoryId, SHA_2)
    const divergedDeployment = await createDeployment('compare-evidence-app', repositoryId, SHA_2)
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_1, headSha: SHA_1 })
    const otherDelivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: SHA_2, headSha: SHA_3 })
    await linkDeploymentToRepositoryCodeDelivery(deliveryDeployment, delivery.id)
    const otherDeliveryDeployment = await createDeployment('compare-evidence-app', repositoryId, SHA_3)
    await linkDeploymentToRepositoryCodeDelivery(otherDeliveryDeployment, otherDelivery.id)
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
        SHA_3,
        SHA_2,
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

    expect(evidence).toHaveLength(4)
    const pairedEvidence = await listRepositoryCodeDeliveryAncestryEvidence(
      repositoryId,
      pool,
      [unresolvedDeployment, divergedDeployment],
      [delivery.id, otherDelivery.id],
      [
        { unresolvedDeploymentId: unresolvedDeployment, deliveryId: delivery.id },
        { unresolvedDeploymentId: divergedDeployment, deliveryId: otherDelivery.id },
      ],
    )
    expect(pairedEvidence).toHaveLength(2)
    expect(
      pairedEvidence.map(({ unresolved_deployment_id, delivery_id }) => [unresolved_deployment_id, delivery_id]),
    ).toEqual([
      [unresolvedDeployment, delivery.id],
      [divergedDeployment, otherDelivery.id],
    ])
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
          unresolved_deployed_sha: SHA_2,
          unresolved_reason: 'ancestry_diverged',
          delivery_id: otherDelivery.id,
          delivery_head_sha: SHA_3,
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
