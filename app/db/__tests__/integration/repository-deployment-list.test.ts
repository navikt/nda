import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { closePool } from '~/db/connection.server'
import { getLinkedObjectivesForApps } from '~/db/deployment-goal-links.server'
import { getDeploymentAppsForRepository, getDeploymentsPaginated } from '~/db/deployments.server'
import {
  seedApp,
  seedApplicationRepository,
  seedDeployment,
  seedDevTeam,
  seedRepository,
  truncateAllTables,
} from './helpers'

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

it('scopes rows and pagination by stored identity or unambiguous legacy links after an app moves', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'repo-a',
    auditStartYear: 2025,
  })
  const otherRepositoryId = await seedRepository(pool, {
    githubRepoId: '456',
    githubOwner: 'navikt',
    githubRepoName: 'repo-b',
    auditStartYear: 2026,
  })
  await seedApplicationRepository(pool, {
    monitoredAppId: appId,
    githubOwner: 'navikt',
    githubRepo: 'repo-a',
    githubRepoId: '123',
    status: 'historical',
  })
  await seedApplicationRepository(pool, {
    monitoredAppId: appId,
    githubOwner: 'navikt',
    githubRepo: 'repo-b',
    githubRepoId: '456',
  })
  const seed = (repo: string | undefined, year = 2025) =>
    seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: repo,
      createdAt: new Date(`${year}-06-01T12:00:00Z`),
      fourEyesStatus: 'unverified_commits',
    })
  const legacyId = await seed('repo-a')
  const storedId = await seed('old-name')
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, storedId])
  const otherId = await seed('repo-a')
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [otherRepositoryId, otherId])
  await seed('repo-b')
  await seed(undefined)
  await seed('repo-a', 2024)
  await pool.query('UPDATE monitored_applications SET is_active = false WHERE id = $1', [appId])

  expect(await getDeploymentAppsForRepository(repositoryId)).toEqual([{ id: appId, team_slug: 'team-a' }])
  const filters = { repository_id: repositoryId, per_app_audit_start_year: true, per_page: 1 }
  const first = await getDeploymentsPaginated(filters)
  const second = await getDeploymentsPaginated({ ...filters, page: 2 })
  expect(first.total).toBe(2)
  expect(first.total_pages).toBe(2)
  expect(second.total).toBe(2)
  expect([...first.deployments, ...second.deployments].map((d) => d.id).sort()).toEqual([legacyId, storedId].sort())
  const noMatch = await getDeploymentsPaginated({ ...filters, four_eyes_status: 'approved' })
  expect(noMatch.total).toBe(0)
  expect(noMatch.deployments).toEqual([])
})

it('excludes ambiguous legacy names while retaining explicit repository identities', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'renamed-repo',
  })
  const otherRepositoryId = await seedRepository(pool, {
    githubRepoId: '456',
    githubOwner: 'navikt',
    githubRepoName: 'reused-name',
  })
  for (const name of ['reused-name', 'historically-reused', 'safe-old-name']) {
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: name,
      githubRepoId: '123',
      status: 'historical',
    })
  }
  await pool.query(
    `INSERT INTO repository_name_history (repository_id, github_owner, github_repo_name)
     VALUES ($1, 'navikt', 'historically-reused')`,
    [otherRepositoryId],
  )
  const ids: number[] = []
  for (const name of ['reused-name', 'historically-reused', 'safe-old-name', 'unknown']) {
    ids.push(
      await seedDeployment(pool, {
        monitoredAppId: appId,
        teamSlug: 'team-a',
        environment: 'prod-gcp',
        githubOwner: 'navikt',
        githubRepo: name,
      }),
    )
  }
  const result = await getDeploymentsPaginated({ repository_id: repositoryId })
  expect(result.total).toBe(1)
  expect(result.deployments.map((d) => d.id)).toEqual([ids[2]])
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = ANY($2)', [repositoryId, ids.slice(0, 2)])
  const explicit = await getDeploymentsPaginated({ repository_id: repositoryId })
  expect(explicit.total).toBe(3)
  expect(explicit.deployments.map((d) => d.id).sort()).toEqual(ids.slice(0, 3).sort())
})

it('scopes goal options to repository deployments within its audit boundary without changing unscoped options', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'repo-a',
    auditStartYear: 2025,
  })
  const otherRepositoryId = await seedRepository(pool, {
    githubRepoId: '456',
    githubOwner: 'navikt',
    githubRepoName: 'repo-b',
  })
  await seedApplicationRepository(pool, {
    monitoredAppId: appId,
    githubOwner: 'navikt',
    githubRepo: 'repo-a',
    githubRepoId: '123',
    status: 'historical',
  })
  const teamId = await seedDevTeam(pool, 'team-a')
  const { rows: boards } = await pool.query<{ id: number }>(
    `INSERT INTO boards (dev_team_id, title, period_type, period_start, period_end, period_label)
     VALUES ($1, 'Board', 'tertiary', '2025-01-01', '2025-04-30', 'T1 2025') RETURNING id`,
    [teamId],
  )
  const objectiveIds: number[] = []
  for (const [index, title] of ['Stored', 'Legacy', 'Other repository', 'Before audit'].entries()) {
    const { rows } = await pool.query<{ id: number }>(
      'INSERT INTO board_objectives (board_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
      [boards[0].id, title, index],
    )
    const objectiveId = rows[0].id
    objectiveIds.push(objectiveId)
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: 'repo-a',
      createdAt: new Date(index === 3 ? '2024-06-01T12:00:00Z' : '2025-06-01T12:00:00Z'),
    })
    if (index !== 1) {
      await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [
        index === 2 ? otherRepositoryId : repositoryId,
        deploymentId,
      ])
    }
    if (index === 1) {
      const { rows: keyResults } = await pool.query<{ id: number }>(
        "INSERT INTO board_key_results (objective_id, title, sort_order) VALUES ($1, 'Key result', 0) RETURNING id",
        [objectiveId],
      )
      await pool.query(
        "INSERT INTO deployment_goal_links (deployment_id, key_result_id, link_method) VALUES ($1, $2, 'manual')",
        [deploymentId, keyResults[0].id],
      )
    } else {
      await pool.query(
        "INSERT INTO deployment_goal_links (deployment_id, objective_id, link_method) VALUES ($1, $2, 'manual')",
        [deploymentId, objectiveId],
      )
    }
  }
  const scoped = await getLinkedObjectivesForApps([appId], repositoryId)
  expect(scoped.map((option) => option.id).sort()).toEqual(objectiveIds.slice(0, 2).sort())
  const unscoped = await getLinkedObjectivesForApps([appId])
  expect(unscoped.map((option) => option.id).sort()).toEqual(objectiveIds.sort())
})
