import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getDeploymentById,
  getDeploymentsNeedingDeployNotify,
  getDeploymentsPaginated,
  getLatestDeploymentForApp,
  upsertNaisApplyDeployment,
} from '~/db/deployments.server'
import { propagateVerificationToSiblings } from '~/db/monorepo.server'
import { APPROVED_STATUSES_SQL, PENDING_STATUSES_SQL } from '~/lib/four-eyes-status'
import { fetchVerificationData } from '~/lib/verification/fetch-data.server'
import { seedApp, seedApplicationRepository, seedDeployment, seedRepository, truncateAllTables } from './helpers'

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

describe('deployment queries', () => {
  it('should insert and retrieve a deployment', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Add feature X',
    })

    const { rows } = await pool.query('SELECT * FROM deployments WHERE id = $1', [depId])
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Add feature X')
    expect(rows[0].team_slug).toBe('team-1')
    expect(rows[0].four_eyes_status).toBe('pending')
  })

  it('should enforce unique nais_deployment_id within a monitored app', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at)
       VALUES ($1, 'unique-id-123', 'team-1', 'my-app', 'prod', NOW())`,
      [appId],
    )

    await expect(
      pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at)
         VALUES ($1, 'unique-id-123', 'team-1', 'my-app', 'prod', NOW())`,
        [appId],
      ),
    ).rejects.toThrow(/unique|duplicate/)
  })

  it('keeps Apply rows out of the legacy Nais deployment cursor', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod-gcp',
      naisDeploymentId: 'legacy-deployment',
      createdAt: new Date('2026-10-10T10:00:00Z'),
    })
    await upsertNaisApplyDeployment({
      monitoredApplicationId: appId,
      sourceId: 'nais-apply:activity:test',
      createdAt: new Date('2026-10-10T11:00:00Z'),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'my-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: null,
      triggerUrl: null,
      detectedGithubOwner: null,
      detectedGithubRepoName: null,
    })

    await expect(getLatestDeploymentForApp(appId)).resolves.toMatchObject({
      nais_deployment_id: 'legacy-deployment',
    })
  })

  it('stores an Apply deployment without a Nais ID as unverifiable and idempotently', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    await pool.query(
      `UPDATE monitored_applications
       SET slack_deploy_notify_enabled = TRUE,
           slack_deploy_channel_id = 'C123',
           slack_deploy_notify_enabled_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
       WHERE id = $1`,
      [appId],
    )
    const params = {
      monitoredApplicationId: appId,
      sourceId: 'nais-apply:activity:test',
      createdAt: new Date(),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'my-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: null,
      triggerUrl: null,
      detectedGithubOwner: null,
      detectedGithubRepoName: null,
      suppressNotifications: true,
    }

    await upsertNaisApplyDeployment(params)
    await upsertNaisApplyDeployment(params)

    const { rows } = await pool.query(
      `SELECT nais_deployment_id, deployment_source, deployment_source_id, four_eyes_status,
              slack_notifications_suppressed_at IS NOT NULL AS notifications_suppressed
       FROM deployments
       WHERE monitored_app_id = $1 AND deployment_source_id = $2`,
      [appId, params.sourceId],
    )
    expect(rows).toEqual([
      {
        nais_deployment_id: null,
        deployment_source: 'nais_apply',
        deployment_source_id: params.sourceId,
        four_eyes_status: 'unverifiable',
        notifications_suppressed: true,
      },
    ])
    await expect(getDeploymentsNeedingDeployNotify()).resolves.toEqual([])
  })

  it('does not associate an Apply deployment with a pending repository link', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    const repositoryOptions = { githubRepoId: '987654', githubOwner: 'navikt', githubRepoName: 'new-app' }
    const repositoryId = await seedRepository(pool, repositoryOptions)
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: repositoryOptions.githubOwner,
      githubRepo: repositoryOptions.githubRepoName,
      githubRepoId: repositoryOptions.githubRepoId,
      status: 'pending_approval',
    })

    const params = {
      monitoredApplicationId: appId,
      sourceId: 'nais-apply:pending-repository',
      createdAt: new Date(),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'my-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: 'a'.repeat(40),
      triggerUrl: 'https://github.com/navikt/new-app/actions/runs/123',
      detectedGithubOwner: repositoryOptions.githubOwner,
      detectedGithubRepoName: repositoryOptions.githubRepoName,
      detectedGithubRepositoryId: repositoryOptions.githubRepoId,
    }
    const deployment = await upsertNaisApplyDeployment(params)

    const { rows } = await pool.query<{ repository_id: number | null; four_eyes_status: string }>(
      'SELECT repository_id, four_eyes_status FROM deployments WHERE id = $1',
      [deployment.id],
    )
    expect(rows[0]).toEqual({ repository_id: null, four_eyes_status: 'unverifiable' })

    await pool.query(
      `UPDATE application_repositories SET status = 'active' WHERE monitored_app_id = $1 AND github_repo_id = $2`,
      [appId, repositoryOptions.githubRepoId],
    )
    await upsertNaisApplyDeployment(params)

    const approvedRows = await pool.query<{ repository_id: number | null; four_eyes_status: string }>(
      'SELECT repository_id, four_eyes_status FROM deployments WHERE id = $1',
      [deployment.id],
    )
    expect(approvedRows.rows[0]).toEqual({ repository_id: repositoryId, four_eyes_status: 'pending' })
  })

  it('reports an Apply SHA conflict instead of comparing local and GitHub repository IDs', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    const githubRepoId = '987654'
    const repositoryId = await seedRepository(pool, {
      githubRepoId,
      githubOwner: 'navikt',
      githubRepoName: 'my-app',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'my-app',
      githubRepoId,
    })
    const params = {
      monitoredApplicationId: appId,
      sourceId: 'nais-apply:sha-conflict',
      createdAt: new Date(),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'my-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: 'a'.repeat(40),
      triggerUrl: 'https://github.com/navikt/my-app/actions/runs/123',
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'my-app',
      detectedGithubRepositoryId: githubRepoId,
    }
    const deployment = await upsertNaisApplyDeployment(params)
    const { rows } = await pool.query<{ repository_id: number | null }>(
      'SELECT repository_id FROM deployments WHERE id = $1',
      [deployment.id],
    )

    expect(rows[0].repository_id).toBe(repositoryId)
    await expect(upsertNaisApplyDeployment({ ...params, commitSha: 'b'.repeat(40) })).rejects.toThrow(
      'Conflicting commit SHAs',
    )
  })

  it('reverifies automatically resolved Apply deliveries when delayed activity moves them earlier', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    const githubRepoId = '987655'
    await seedRepository(pool, {
      githubRepoId,
      githubOwner: 'navikt',
      githubRepoName: 'my-app',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'my-app',
      githubRepoId,
    })
    const params = {
      monitoredApplicationId: appId,
      sourceId: 'nais-apply:delayed-activity',
      createdAt: new Date('2026-10-15T10:00:00Z'),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'my-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: 'a'.repeat(40),
      triggerUrl: 'https://github.com/navikt/my-app/actions/runs/123',
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'my-app',
      detectedGithubRepositoryId: githubRepoId,
    }
    const deployment = await upsertNaisApplyDeployment(params)
    await pool.query("UPDATE deployments SET four_eyes_status = 'approved' WHERE id = $1", [deployment.id])

    await upsertNaisApplyDeployment({
      ...params,
      createdAt: new Date('2026-10-15T09:00:00Z'),
    })

    const { rows } = await pool.query(
      `SELECT d.created_at, d.four_eyes_status, h.from_status, h.to_status, h.change_source
       FROM deployments d
       LEFT JOIN deployment_status_history h ON h.deployment_id = d.id
       WHERE d.id = $1`,
      [deployment.id],
    )
    expect(rows[0]).toMatchObject({
      created_at: new Date('2026-10-15T09:00:00Z'),
      four_eyes_status: 'pending',
      from_status: 'approved',
      to_status: 'pending',
      change_source: 'nais_apply_timestamp_correction',
    })
  })

  it('requeues sibling approvals when a delayed Apply delivery moves its approved root earlier', async () => {
    const rootAppId = await seedApp(pool, { teamSlug: 'team-1', appName: 'root-app', environment: 'prod-gcp' })
    const siblingAppId = await seedApp(pool, { teamSlug: 'team-1', appName: 'sibling-app', environment: 'prod-gcp' })
    const legacySiblingAppId = await seedApp(pool, {
      teamSlug: 'team-1',
      appName: 'legacy-sibling-app',
      environment: 'prod-gcp',
    })
    const unrelatedAppId = await seedApp(pool, {
      teamSlug: 'team-1',
      appName: 'unrelated-app',
      environment: 'prod-gcp',
    })
    const repositoryOptions = { githubRepoId: '987656', githubOwner: 'navikt', githubRepoName: 'my-app' }
    const repositoryId = await seedRepository(pool, repositoryOptions)
    const unrelatedRepositoryId = await seedRepository(pool, {
      githubRepoId: '987657',
      githubOwner: 'navikt',
      githubRepoName: 'unrelated-app',
    })
    for (const monitoredAppId of [rootAppId, siblingAppId, legacySiblingAppId]) {
      await seedApplicationRepository(pool, {
        monitoredAppId,
        githubOwner: repositoryOptions.githubOwner,
        githubRepo: repositoryOptions.githubRepoName,
        githubRepoId: repositoryOptions.githubRepoId,
      })
    }
    await seedApplicationRepository(pool, {
      monitoredAppId: unrelatedAppId,
      githubOwner: 'navikt',
      githubRepo: 'unrelated-app',
      githubRepoId: '987657',
    })

    const params = {
      monitoredApplicationId: rootAppId,
      sourceId: 'nais-apply:delayed-activity-with-sibling',
      createdAt: new Date('2026-10-15T10:00:00Z'),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'root-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: 'c'.repeat(40),
      triggerUrl: 'https://github.com/navikt/my-app/actions/runs/124',
      detectedGithubOwner: repositoryOptions.githubOwner,
      detectedGithubRepoName: repositoryOptions.githubRepoName,
      detectedGithubRepositoryId: repositoryOptions.githubRepoId,
    }
    const root = await upsertNaisApplyDeployment(params)
    await pool.query("UPDATE deployments SET four_eyes_status = 'approved' WHERE id = $1", [root.id])

    const siblingId = await seedDeployment(pool, {
      monitoredAppId: siblingAppId,
      teamSlug: 'team-1',
      environment: 'prod-gcp',
      commitSha: params.commitSha,
      createdAt: new Date('2026-10-15T11:00:00Z'),
      fourEyesStatus: 'verified_via_sibling',
      githubOwner: repositoryOptions.githubOwner,
      githubRepo: repositoryOptions.githubRepoName,
    })
    const legacySiblingId = await seedDeployment(pool, {
      monitoredAppId: legacySiblingAppId,
      teamSlug: 'team-1',
      environment: 'prod-gcp',
      commitSha: params.commitSha,
      createdAt: new Date('2026-10-15T11:00:00Z'),
      fourEyesStatus: 'verified_via_sibling',
      githubOwner: repositoryOptions.githubOwner,
      githubRepo: repositoryOptions.githubRepoName,
    })
    const unrelatedSiblingId = await seedDeployment(pool, {
      monitoredAppId: unrelatedAppId,
      teamSlug: 'team-1',
      environment: 'prod-gcp',
      commitSha: params.commitSha,
      createdAt: new Date('2026-10-15T11:00:00Z'),
      fourEyesStatus: 'verified_via_sibling',
      githubOwner: 'navikt',
      githubRepo: 'unrelated-app',
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, siblingId])
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [
      unrelatedRepositoryId,
      unrelatedSiblingId,
    ])

    await upsertNaisApplyDeployment({
      ...params,
      createdAt: new Date('2026-10-15T09:00:00Z'),
    })
    await pool.query("UPDATE deployments SET four_eyes_status = 'direct_push' WHERE id = $1", [root.id])
    await expect(propagateVerificationToSiblings(root.id, 'direct_push', params.commitSha, rootAppId)).resolves.toBe(0)

    const { rows } = await pool.query(
      `SELECT d.id, d.four_eyes_status, h.from_status, h.to_status, h.change_source
       FROM deployments d
       LEFT JOIN deployment_status_history h
         ON h.deployment_id = d.id AND h.change_source = 'nais_apply_timestamp_correction'
       WHERE d.id = ANY($1::int[])
       ORDER BY d.id`,
      [[root.id, siblingId, legacySiblingId, unrelatedSiblingId]],
    )
    expect(rows).toEqual([
      {
        id: root.id,
        four_eyes_status: 'direct_push',
        from_status: 'approved',
        to_status: 'pending',
        change_source: 'nais_apply_timestamp_correction',
      },
      {
        id: siblingId,
        four_eyes_status: 'pending',
        from_status: 'verified_via_sibling',
        to_status: 'pending',
        change_source: 'nais_apply_timestamp_correction',
      },
      {
        id: legacySiblingId,
        four_eyes_status: 'pending',
        from_status: 'verified_via_sibling',
        to_status: 'pending',
        change_source: 'nais_apply_timestamp_correction',
      },
      {
        id: unrelatedSiblingId,
        four_eyes_status: 'verified_via_sibling',
        from_status: null,
        to_status: null,
        change_source: null,
      },
    ])
  })

  it('rejects verification of an Apply deployment with no stored repository association', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod-gcp',
      commitSha: 'd'.repeat(40),
      githubOwner: 'navikt',
      githubRepo: 'my-app',
    })
    await pool.query(
      `UPDATE deployments
       SET nais_deployment_id = NULL,
           deployment_source = 'nais_apply',
           deployment_source_id = 'nais-apply:unassociated',
           repository_id = NULL
       WHERE id = $1`,
      [deploymentId],
    )

    await expect(
      fetchVerificationData(
        deploymentId,
        'd'.repeat(40),
        'navikt/my-app',
        'prod-gcp',
        'main',
        appId,
        undefined,
        undefined,
        123,
      ),
    ).rejects.toThrow('without an immutable repository association')
  })

  it('preserves manually approved Apply deliveries when delayed activity moves them earlier', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    const params = {
      monitoredApplicationId: appId,
      sourceId: 'nais-apply:delayed-manual-approval',
      createdAt: new Date('2026-10-15T10:00:00Z'),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'my-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: null,
      triggerUrl: null,
      detectedGithubOwner: null,
      detectedGithubRepoName: null,
    }
    const deployment = await upsertNaisApplyDeployment(params)
    await pool.query("UPDATE deployments SET four_eyes_status = 'manually_approved' WHERE id = $1", [deployment.id])

    await upsertNaisApplyDeployment({
      ...params,
      createdAt: new Date('2026-10-15T09:00:00Z'),
    })

    const { rows } = await pool.query('SELECT created_at, four_eyes_status FROM deployments WHERE id = $1', [
      deployment.id,
    ])
    expect(rows[0]).toEqual({
      created_at: new Date('2026-10-15T09:00:00Z'),
      four_eyes_status: 'manually_approved',
    })
  })

  it('includes stored Apply deployments in listings and notifications without opt-in', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod-gcp' })
    await pool.query(
      `UPDATE monitored_applications
       SET slack_deploy_notify_enabled = TRUE,
           slack_deploy_channel_id = 'C123',
           slack_deploy_notify_enabled_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
       WHERE id = $1`,
      [appId],
    )
    const deployment = await upsertNaisApplyDeployment({
      monitoredApplicationId: appId,
      sourceId: 'nais-apply:activity:toggle-test',
      createdAt: new Date(),
      teamSlug: 'team-1',
      environmentName: 'prod-gcp',
      appName: 'my-app',
      title: 'Nais Apply: registry/image:latest',
      deployerUsername: 'developer',
      commitSha: null,
      triggerUrl: null,
      detectedGithubOwner: null,
      detectedGithubRepoName: null,
    })

    await expect(pool.query('SELECT id FROM deployments WHERE id = $1', [deployment.id])).resolves.toMatchObject({
      rows: [{ id: deployment.id }],
    })

    await expect(getDeploymentById(deployment.id)).resolves.toMatchObject({ id: deployment.id })
    await expect(getDeploymentsPaginated({ monitored_app_id: appId })).resolves.toMatchObject({
      deployments: [expect.objectContaining({ id: deployment.id })],
      total: 1,
    })
    await expect(getDeploymentsNeedingDeployNotify()).resolves.toMatchObject([
      expect.objectContaining({ id: deployment.id }),
    ])
  })

  it('should update title with COALESCE (preserving existing value)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Original title',
    })

    await pool.query(`UPDATE deployments SET title = COALESCE($2, title) WHERE id = $1`, [depId, 'New title'])
    const { rows: r1 } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    expect(r1[0].title).toBe('New title')

    await pool.query(`UPDATE deployments SET title = COALESCE($2, title) WHERE id = $1`, [depId, null])
    const { rows: r2 } = await pool.query('SELECT title FROM deployments WHERE id = $1', [depId])
    expect(r2[0].title).toBe('New title')
  })

  it('should filter deployments by date range and team', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-1', environment: 'prod' })

    const jan = new Date('2025-01-15T12:00:00Z')
    const feb = new Date('2025-02-15T12:00:00Z')
    const mar = new Date('2025-03-15T12:00:00Z')

    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: jan })
    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: feb })
    await seedDeployment(pool, { monitoredAppId: appId, teamSlug: 'team-a', environment: 'prod', createdAt: mar })

    const startDate = new Date('2025-02-01')
    const endDate = new Date('2025-03-01')

    const { rows } = await pool.query(
      `SELECT id FROM deployments
       WHERE team_slug = $1
         AND created_at >= $2
         AND created_at < $3
       ORDER BY created_at`,
      ['team-a', startDate, endDate],
    )

    expect(rows).toHaveLength(1)
  })

  it('should count deployments using FILTER clause correctly', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'app-x', environment: 'prod' })

    for (const status of ['approved_pr', 'approved_pr', 'direct_push', 'pending']) {
      const naisId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at, four_eyes_status)
         VALUES ($1, $2, 'team-x', 'app-x', 'prod', NOW(), $3)`,
        [appId, naisId, status],
      )
    }

    const { rows } = await pool.query(`
      SELECT
        COUNT(id)::int AS total,
        COUNT(id) FILTER (WHERE four_eyes_status IN (${APPROVED_STATUSES_SQL}))::int AS with_four_eyes,
        COUNT(id) FILTER (WHERE four_eyes_status IN ('direct_push', 'unverified_commits'))::int AS without_four_eyes,
        COUNT(id) FILTER (WHERE COALESCE(four_eyes_status, 'unknown') IN (${PENDING_STATUSES_SQL}))::int AS pending
      FROM deployments
      WHERE team_slug = 'team-x'
    `)

    expect(rows[0].total).toBe(4)
    expect(rows[0].with_four_eyes).toBe(2)
    expect(rows[0].without_four_eyes).toBe(1)
    expect(rows[0].pending).toBe(1)
  })
})

describe('title fallback chain (COALESCE)', () => {
  const titleQuery = `
    SELECT
      COALESCE(d.title, d.github_pr_data->>'title', c.original_pr_title, c.message, d.unverified_commits->0->>'message') AS title
    FROM deployments d
    LEFT JOIN commits c ON c.sha = d.commit_sha
      AND c.repo_owner = d.detected_github_owner
      AND c.repo_name = d.detected_github_repo_name
    WHERE d.id = $1
  `

  it('should fall back to github_pr_data title when title is null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      githubPrData: { title: 'PR title from github_pr_data' },
    })

    const { rows } = await pool.query(titleQuery, [depId])
    expect(rows[0].title).toBe('PR title from github_pr_data')
  })

  it('should fall back to commits.original_pr_title when title and github_pr_data are null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const sha = 'abc123fallback'
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas, original_pr_title)
       VALUES ($1, 'navikt', 'my-repo', 'alice', 'commit msg', false, '[]', 'Original PR Title')`,
      [sha],
    )

    const { rows } = await pool.query(titleQuery, [depId])
    expect(rows[0].title).toBe('Original PR Title')
  })

  it('should fall back to commits.message when title, github_pr_data, and original_pr_title are null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const sha = 'def456fallback'
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      commitSha: sha,
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
    })

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas)
       VALUES ($1, 'navikt', 'my-repo', 'bob', 'feat: add logging', false, '[]')`,
      [sha],
    )

    const { rows } = await pool.query(titleQuery, [depId])
    expect(rows[0].title).toBe('feat: add logging')
  })

  it('should fall back to unverified_commits first message when all other sources are null', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const naisId = `dep-unverified-${Date.now()}`
    const { rows: insertRows } = await pool.query(
      `INSERT INTO deployments (
        monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at,
        unverified_commits
      ) VALUES ($1, $2, 'team-1', 'test-app', 'prod', NOW(), $3::jsonb)
      RETURNING id`,
      [appId, naisId, JSON.stringify([{ sha: 'xyz', message: 'unverified commit msg', author: 'charlie' }])],
    )

    const { rows } = await pool.query(titleQuery, [insertRows[0].id])
    expect(rows[0].title).toBe('unverified commit msg')
  })

  it('should respect priority order: d.title > github_pr_data > original_pr_title > message > unverified', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const sha = 'priority123'
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Explicit title',
      commitSha: sha,
      githubOwner: 'navikt',
      githubRepo: 'my-repo',
      githubPrData: { title: 'PR data title' },
    })

    await pool.query(
      `INSERT INTO commits (sha, repo_owner, repo_name, author_username, message, is_merge_commit, parent_shas, original_pr_title)
       VALUES ($1, 'navikt', 'my-repo', 'dave', 'commit message', false, '[]', 'Original PR title')`,
      [sha],
    )

    const { rows: r1 } = await pool.query(titleQuery, [depId])
    expect(r1[0].title).toBe('Explicit title')

    await pool.query('UPDATE deployments SET title = NULL WHERE id = $1', [depId])
    const { rows: r2 } = await pool.query(titleQuery, [depId])
    expect(r2[0].title).toBe('PR data title')

    await pool.query('UPDATE deployments SET github_pr_data = NULL WHERE id = $1', [depId])
    const { rows: r3 } = await pool.query(titleQuery, [depId])
    expect(r3[0].title).toBe('Original PR title')

    await pool.query(
      "UPDATE commits SET original_pr_title = NULL WHERE sha = $1 AND repo_owner = 'navikt' AND repo_name = 'my-repo'",
      [sha],
    )
    const { rows: r4 } = await pool.query(titleQuery, [depId])
    expect(r4[0].title).toBe('commit message')
  })
})

describe('manual approval preserves existing data', () => {
  it('should keep title and github_pr_data when status changes to manually_approved', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-1', appName: 'my-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-1',
      environment: 'prod',
      title: 'Legg til oversetting for AFP Stat kontroll',
      fourEyesStatus: 'unverified_commits',
      githubPrData: { title: 'Legg til oversetting for AFP Stat kontroll', number: 579 },
    })

    await pool.query(
      `UPDATE deployments 
       SET github_pr_number = 579,
           github_pr_url = 'https://github.com/navikt/repo/pull/579',
           unverified_commits = $2::jsonb
       WHERE id = $1`,
      [
        depId,
        JSON.stringify([
          { sha: '7de20a1', message: 'Legg til oversetting for AFP Stat kontroll (#579)', author: 'alice' },
        ]),
      ],
    )

    const before = await pool.query('SELECT * FROM deployments WHERE id = $1', [depId])
    const existing = before.rows[0]

    await pool.query(
      `UPDATE deployments 
       SET four_eyes_status = 'manually_approved',
           github_pr_number = $2,
           github_pr_url = $3,
           github_pr_data = $4,
           title = $5,
           unverified_commits = $6
       WHERE id = $1`,
      [
        depId,
        existing.github_pr_number,
        existing.github_pr_url,
        existing.github_pr_data ? JSON.stringify(existing.github_pr_data) : null,
        existing.title,
        existing.unverified_commits ? JSON.stringify(existing.unverified_commits) : null,
      ],
    )

    const { rows } = await pool.query('SELECT * FROM deployments WHERE id = $1', [depId])
    expect(rows[0].four_eyes_status).toBe('manually_approved')
    expect(rows[0].title).toBe('Legg til oversetting for AFP Stat kontroll')
    expect(rows[0].github_pr_number).toBe(579)
    expect(rows[0].github_pr_url).toBe('https://github.com/navikt/repo/pull/579')
    expect(rows[0].github_pr_data).toEqual({ title: 'Legg til oversetting for AFP Stat kontroll', number: 579 })
    expect(rows[0].unverified_commits).toEqual([
      { sha: '7de20a1', message: 'Legg til oversetting for AFP Stat kontroll (#579)', author: 'alice' },
    ])
  })
})

describe('not_approved filter includes unrecognized statuses', () => {
  it('should include deployments with unrecognized four_eyes_status in not_approved filter', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-filter', appName: 'app-filter', environment: 'prod' })

    const statuses = ['approved_pr', 'pending', 'direct_push', 'some_unknown_status', null]
    for (const status of statuses) {
      const naisId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await pool.query(
        `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at, four_eyes_status)
         VALUES ($1, $2, 'team-filter', 'app-filter', 'prod', NOW(), $3)`,
        [appId, naisId, status],
      )
    }

    const { rows } = await pool.query(`
      SELECT d.four_eyes_status
      FROM deployments d
      JOIN monitored_applications ma ON d.monitored_app_id = ma.id
      WHERE d.team_slug = 'team-filter'
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${APPROVED_STATUSES_SQL})
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${PENDING_STATUSES_SQL})
      ORDER BY d.four_eyes_status
    `)

    expect(rows).toHaveLength(2)
    const statuses_found = rows.map((r: { four_eyes_status: string | null }) => r.four_eyes_status)
    expect(statuses_found).toContain('direct_push')
    expect(statuses_found).toContain('some_unknown_status')
  })

  it('should NOT include NULL status in not_approved (NULL → unknown → pending)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-null', appName: 'app-null', environment: 'prod' })

    await pool.query(
      `INSERT INTO deployments (monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name, created_at, four_eyes_status)
       VALUES ($1, 'dep-null-1', 'team-null', 'app-null', 'prod', NOW(), NULL)`,
      [appId],
    )

    const { rows } = await pool.query(`
      SELECT d.four_eyes_status
      FROM deployments d
      WHERE d.team_slug = 'team-null'
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${APPROVED_STATUSES_SQL})
        AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${PENDING_STATUSES_SQL})
    `)

    expect(rows).toHaveLength(0)
  })
})

describe('getDeploymentById backfills checks_ref for legacy data', () => {
  it('sets checks_ref to head when check head_sha matches head_sha', async () => {
    const appId = await seedApp(pool, { teamSlug: 'glad-fjord', appName: 'min-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'glad-fjord',
      environment: 'prod',
      githubPrData: {
        title: 'Bump dep',
        head_sha: 'headabc',
        merge_commit_sha: 'mergedef',
        merged_at: '2026-05-01T10:00:00Z',
        checks: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', head_sha: 'headabc' }],
      },
    })

    const { getDeploymentById } = await import('~/db/deployments.server')
    const result = await getDeploymentById(depId)
    expect(result?.github_pr_data?.checks_ref).toBe('head')
  })

  it('sets checks_ref to merge_commit when check head_sha matches merge_commit_sha', async () => {
    const appId = await seedApp(pool, { teamSlug: 'rask-elv', appName: 'min-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'rask-elv',
      environment: 'prod',
      githubPrData: {
        title: 'Bump dep',
        head_sha: 'headabc',
        merge_commit_sha: 'mergedef',
        merged_at: '2026-05-01T10:00:00Z',
        checks: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', head_sha: 'mergedef' }],
      },
    })

    const { getDeploymentById } = await import('~/db/deployments.server')
    const result = await getDeploymentById(depId)
    expect(result?.github_pr_data?.checks_ref).toBe('merge_commit')
  })

  it('sets checks_ref to head when no check has head_sha (older cached data)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'sterk-skog', appName: 'min-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'sterk-skog',
      environment: 'prod',
      githubPrData: {
        title: 'Bump dep',
        head_sha: 'headabc',
        merge_commit_sha: 'mergedef',
        merged_at: '2026-05-01T10:00:00Z',
        checks: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success' }],
      },
    })

    const { getDeploymentById } = await import('~/db/deployments.server')
    const result = await getDeploymentById(depId)
    expect(result?.github_pr_data?.checks_ref).toBe('head')
  })

  it('sets checks_ref to null when PR has no merge_commit_sha (open PR)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'blid-stein', appName: 'min-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'blid-stein',
      environment: 'prod',
      githubPrData: {
        title: 'Open PR',
        head_sha: 'headabc',
        merge_commit_sha: null,
        merged_at: null,
        checks: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', head_sha: 'headabc' }],
      },
    })

    const { getDeploymentById } = await import('~/db/deployments.server')
    const result = await getDeploymentById(depId)
    expect(result?.github_pr_data?.checks_ref).toBeNull()
  })

  it('preserves existing checks_ref without recomputing', async () => {
    const appId = await seedApp(pool, { teamSlug: 'trygg-dal', appName: 'min-app', environment: 'prod' })
    const depId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'trygg-dal',
      environment: 'prod',
      githubPrData: {
        title: 'Already computed',
        head_sha: 'headabc',
        merge_commit_sha: 'mergedef',
        merged_at: '2026-05-01T10:00:00Z',
        checks_ref: 'merge_commit',
        checks: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', head_sha: 'headabc' }],
      },
    })

    const { getDeploymentById } = await import('~/db/deployments.server')
    const result = await getDeploymentById(depId)
    expect(result?.github_pr_data?.checks_ref).toBe('merge_commit')
  })
})
