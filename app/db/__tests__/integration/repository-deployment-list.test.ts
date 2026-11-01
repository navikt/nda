import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { closePool } from '~/db/connection.server'
import { getLinkedObjectivesForApps } from '~/db/deployment-goal-links.server'
import { getRepositoryDeploymentsPaginated } from '~/db/deployment-repository-list.server'
import { getDeploymentRepositoryView } from '~/db/deployment-repository-view.server'
import {
  getDeploymentAppsForRepository,
  getDeploymentsPaginated,
  upsertNaisApplyDeployment,
} from '~/db/deployments.server'
import {
  createRepositoryCodeDelivery,
  linkDeploymentToRepositoryCodeDelivery,
} from '~/db/repository-code-deliveries.server'
import { getPreviousDeploymentForDiff } from '~/db/verification-diff.server'
import {
  findRootApprovedSiblingForCommit,
  getPreviousDeployment,
} from '~/lib/verification/fetch-data/previous-deployment.server'
import {
  seedApp,
  seedApplicationRepository,
  seedDeployment,
  seedDevTeam,
  seedRepository,
  seedSection,
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

it('does not associate Apply rows without a verified repository ID through a name fallback', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'repo-a',
  })
  await seedApplicationRepository(pool, {
    monitoredAppId: appId,
    githubOwner: 'navikt',
    githubRepo: 'repo-a',
    githubRepoId: '123',
  })
  await upsertNaisApplyDeployment({
    monitoredApplicationId: appId,
    sourceId: 'nais-apply:unverified-repository',
    createdAt: new Date(),
    teamSlug: 'team-a',
    environmentName: 'prod-gcp',
    appName: 'app-a',
    title: 'Nais Apply: registry/image:latest',
    deployerUsername: 'developer',
    commitSha: null,
    triggerUrl: null,
    detectedGithubOwner: 'navikt',
    detectedGithubRepoName: 'repo-a',
  })

  const result = await getDeploymentsPaginated({ repository_id: repositoryId })

  expect(result.total).toBe(0)
  expect(result.deployments).toEqual([])
})

it('prioritizes canonical and separate identities over reused names in repository rows and app options', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const otherAppId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'prod-gcp' })
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
  await seedApplicationRepository(pool, {
    monitoredAppId: otherAppId,
    githubOwner: 'navikt',
    githubRepo: 'safe-old-name',
    githubRepoId: '123',
    status: 'historical',
  })
  const seed = (monitoredAppId: number, name: string) =>
    seedDeployment(pool, {
      monitoredAppId,
      teamSlug: monitoredAppId === appId ? 'team-a' : 'team-b',
      environment: 'prod-gcp',
      githubOwner: 'navikt',
      githubRepo: name,
    })
  const separate = await seed(appId, 'reused-name')
  const canonical = await seed(appId, 'reused-name')
  const otherCanonical = await seed(otherAppId, 'reused-name')
  const otherSeparate = await seed(otherAppId, 'safe-old-name')
  await pool.query(
    `INSERT INTO repository_code_delivery_deployment_repositories (deployment_id, repository_id)
       VALUES ($1, $5), ($2, $6), ($3, $5), ($4, $6)`,
    [separate, canonical, otherCanonical, otherSeparate, repositoryId, otherRepositoryId],
  )
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, canonical])
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [otherRepositoryId, otherCanonical])

  const result = await getDeploymentsPaginated({ repository_id: repositoryId })
  expect(result.total).toBe(2)
  expect(result.deployments.map((deployment) => deployment.id).sort()).toEqual([separate, canonical].sort())
  expect(await getDeploymentAppsForRepository(repositoryId)).toEqual([{ id: appId, team_slug: 'team-a' }])
  const other = await getDeploymentsPaginated({ repository_id: otherRepositoryId })
  expect(other.total).toBe(2)
  expect(other.deployments.map((deployment) => deployment.id).sort()).toEqual([otherCanonical, otherSeparate].sort())
})

it('reads list and detail assessments for delivery links with only separate repository identity', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'glad-fjord-api', environment: 'prod-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'repo-a',
  })
  const headSha = 'a'.repeat(40)
  const deploymentId = await seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-fjord',
    environment: 'prod-gcp',
    commitSha: headSha,
    fourEyesStatus: 'unverified_commits',
  })
  await pool.query(
    'INSERT INTO repository_code_delivery_deployment_repositories (deployment_id, repository_id) VALUES ($1, $2)',
    [deploymentId, repositoryId],
  )
  const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha: headSha, headSha })
  await linkDeploymentToRepositoryCodeDelivery(deploymentId, delivery.id)

  const list = await getRepositoryDeploymentsPaginated({ repository_id: repositoryId })
  expect(list.deployments.map((deployment) => deployment.id)).toEqual([deploymentId])
  expect(list.repositorySummaries[deploymentId]).toMatchObject({ range: { baseSha: headSha, headSha } })
  const detail = await getDeploymentRepositoryView(deploymentId, null, appId)
  expect(detail?.link).toMatchObject({
    state: 'linked',
    deployments: [expect.objectContaining({ id: deploymentId })],
    deploymentCount: 1,
  })
  expect(
    (await pool.query('SELECT repository_id, four_eyes_status FROM deployments WHERE id = $1', [deploymentId])).rows,
  ).toEqual([{ repository_id: null, four_eyes_status: 'unverified_commits' }])
})

it('keeps separately identified history visible without changing app verification after repository name reuse', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'glad-fjord-api', environment: 'prod-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'renamed-repo',
  })
  await seedRepository(pool, { githubRepoId: '456', githubOwner: 'navikt', githubRepoName: 'reused-name' })
  await seedApplicationRepository(pool, {
    monitoredAppId: appId,
    githubOwner: 'navikt',
    githubRepo: 'reused-name',
    githubRepoId: '123',
    status: 'historical',
  })
  const olderSha = 'a'.repeat(40)
  const currentSha = 'b'.repeat(40)
  const older = await seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-fjord',
    environment: 'prod-gcp',
    githubOwner: 'navikt',
    githubRepo: 'reused-name',
    commitSha: olderSha,
    fourEyesStatus: 'approved',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  })
  const current = await seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-fjord',
    environment: 'prod-gcp',
    githubOwner: 'navikt',
    githubRepo: 'renamed-repo',
    commitSha: currentSha,
    createdAt: new Date('2024-01-02T00:00:00Z'),
  })
  await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, current])
  await pool.query(
    'INSERT INTO repository_code_delivery_deployment_repositories (deployment_id, repository_id) VALUES ($1, $2)',
    [older, repositoryId],
  )

  const list = await getDeploymentsPaginated({ repository_id: repositoryId })
  expect(list.deployments.map((deployment) => deployment.id).sort()).toEqual([older, current].sort())
  const repositoryList = await getRepositoryDeploymentsPaginated({ repository_id: repositoryId })
  expect(repositoryList.deployments.find((deployment) => deployment.id === older)?.detected_github_repo_name).toBe(
    'reused-name',
  )
  expect(await getPreviousDeploymentForDiff(current, '123')).toBeNull()
  expect(await getPreviousDeployment(current, 'navikt', 'renamed-repo', '123', null, currentSha)).toBeNull()
  expect(await findRootApprovedSiblingForCommit(olderSha, '123', current)).toBeNull()
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
  const sectionId = await seedSection(pool, 'section-a')
  const teamId = await seedDevTeam(pool, 'team-a', 'Team A', sectionId)
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

it('paginates complete filtered SHA groups, keeping missing SHAs separate and excluding other repositories', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const secondAppId = await seedApp(pool, { teamSlug: 'team-b', appName: 'app-b', environment: 'dev-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'repo-a',
  })
  const otherRepositoryId = await seedRepository(pool, {
    githubRepoId: '456',
    githubOwner: 'navikt',
    githubRepoName: 'repo-b',
  })
  const seed = async (
    sha: string | null,
    day: number,
    repoId = repositoryId,
    status = 'unverified_commits',
    monitoredAppId = appId,
  ) => {
    const id = await seedDeployment(pool, {
      monitoredAppId,
      teamSlug: monitoredAppId === appId ? 'team-a' : 'team-b',
      environment: monitoredAppId === appId ? 'prod-gcp' : 'dev-gcp',
      commitSha: sha,
      createdAt: new Date(`2025-06-${String(day).padStart(2, '0')}T12:00:00Z`),
      fourEyesStatus: status,
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repoId, id])
    return id
  }
  const olderSameSha = await seed('a'.repeat(40), 1)
  const otherSha = await seed(`${'a'.repeat(39)}b`, 2)
  const newerSameSha = await seed('a'.repeat(40), 3, repositoryId, 'unverified_commits', secondAppId)
  await seed('a'.repeat(40), 4, otherRepositoryId)
  await seed('a'.repeat(40), 5, repositoryId, 'approved')
  const noSha = await seed(null, 1)
  const emptySha = await seed('', 1)
  const filters = {
    repository_id: repositoryId,
    group_by_sha: true,
    four_eyes_status: 'not_approved',
    start_date: new Date('2025-06-01T00:00:00Z'),
    end_date: new Date('2025-06-04T00:00:00Z'),
    per_page: 1,
  }
  const first = await getDeploymentsPaginated(filters)
  expect(first.total).toBe(4)
  expect(first.total_pages).toBe(4)
  expect(first.deployments.map((d) => d.id)).toEqual([newerSameSha, olderSameSha])
  const second = await getDeploymentsPaginated({ ...filters, page: 2 })
  expect(second.deployments.map((d) => d.id)).toEqual([otherSha])
  const third = await getDeploymentsPaginated({ ...filters, page: 3 })
  const fourth = await getDeploymentsPaginated({ ...filters, page: 4 })
  expect(third.deployments.map((d) => d.id)).toEqual([emptySha])
  expect(fourth.deployments.map((d) => d.id)).toEqual([noSha])
  const beyond = await getDeploymentsPaginated({ ...filters, page: 5 })
  expect(beyond.deployments).toEqual([])
  expect(beyond.total).toBe(4)
  const normal = await getDeploymentsPaginated({ ...filters, group_by_sha: false })
  expect(normal.total).toBe(5)
  expect(normal.deployments).toHaveLength(1)
})

it('orders tied SHA groups by their latest deployment IDs, not IDs of later-imported historical rows', async () => {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'repo-a',
  })
  const seed = async (sha: string, createdAt: string) => {
    const id = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: sha,
      createdAt: new Date(createdAt),
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, id])
    return id
  }
  const latestA = await seed('a'.repeat(40), '2025-06-02T12:00:00Z')
  const latestB = await seed('b'.repeat(40), '2025-06-02T12:00:00Z')
  const filters = { repository_id: repositoryId, group_by_sha: true, per_page: 1 }
  const beforeImport = await getDeploymentsPaginated(filters)
  expect(beforeImport.deployments.map((d) => d.id)).toEqual([latestB])
  const historicalA = await seed('a'.repeat(40), '2025-06-01T12:00:00Z')
  const afterImport = await getDeploymentsPaginated(filters)
  expect(afterImport.total).toBe(2)
  expect(afterImport.total_pages).toBe(2)
  expect(afterImport.deployments.map((d) => d.id)).toEqual([latestB])
  const second = await getDeploymentsPaginated({ ...filters, page: 2 })
  expect(second.deployments.map((d) => d.id)).toEqual([latestA, historicalA])
})
