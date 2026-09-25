import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getDeploymentsWithStatusChangesForApps } from '~/db/deployments.server'
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

const IN_PERIOD = new Date('2026-06-15T10:00:00Z')

async function seedTransition(opts: {
  deploymentId: number
  fromStatus: string | null
  toStatus: string
  changeSource: string
  createdAt: Date
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO deployment_status_history (deployment_id, from_status, to_status, change_source, created_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [opts.deploymentId, opts.fromStatus, opts.toStatus, opts.changeSource, opts.createdAt],
  )
  return rows[0].id
}

async function linkAppToRepo(opts: {
  monitoredAppId: number
  githubOwner: string
  githubRepoName: string
  githubRepoId: string
  status?: 'active' | 'historical' | 'pending_approval'
}): Promise<number> {
  await seedApplicationRepository(pool, {
    monitoredAppId: opts.monitoredAppId,
    githubOwner: opts.githubOwner,
    githubRepo: opts.githubRepoName,
    githubRepoId: opts.githubRepoId,
    status: opts.status ?? 'active',
  })
  return seedRepository(pool, {
    githubRepoId: opts.githubRepoId,
    githubOwner: opts.githubOwner,
    githubRepoName: opts.githubRepoName,
  })
}

describe('getDeploymentsWithStatusChangesForApps', () => {
  it('returns deployments only for the requested app IDs, excluding other apps', async () => {
    const includedApp = await seedApp(pool, { teamSlug: 'team-shfa', appName: 'app-shfa', environment: 'prod' })
    const excludedApp = await seedApp(pool, { teamSlug: 'team-shfb', appName: 'app-shfb', environment: 'prod' })
    const includedRepoId = await linkAppToRepo({
      monitoredAppId: includedApp,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfa',
      githubRepoId: '910001',
    })
    await linkAppToRepo({
      monitoredAppId: excludedApp,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfb',
      githubRepoId: '910002',
    })

    const includedDeployment = await seedDeployment(pool, {
      monitoredAppId: includedApp,
      teamSlug: 'team-shfa',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shfa',
    })
    const excludedDeployment = await seedDeployment(pool, {
      monitoredAppId: excludedApp,
      teamSlug: 'team-shfb',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shfb',
    })

    for (const deploymentId of [includedDeployment, excludedDeployment]) {
      await seedTransition({
        deploymentId,
        fromStatus: null,
        toStatus: 'pending',
        changeSource: 'nais_sync',
        createdAt: IN_PERIOD,
      })
      await seedTransition({
        deploymentId,
        fromStatus: 'pending',
        toStatus: 'approved',
        changeSource: 'github_verify',
        createdAt: new Date(IN_PERIOD.getTime() + 1000),
      })
    }

    const result = await getDeploymentsWithStatusChangesForApps([includedApp], includedRepoId)
    expect(result).toHaveLength(1)
    expect(result[0].deployment_id).toBe(includedDeployment)
  })

  it('excludes deployments with only a single transition', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-shfc', appName: 'app-shfc', environment: 'prod' })
    const repositoryId = await linkAppToRepo({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfc',
      githubRepoId: '910003',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-shfc',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shfc',
    })
    await seedTransition({
      deploymentId,
      fromStatus: null,
      toStatus: 'approved',
      changeSource: 'nais_sync',
      createdAt: IN_PERIOD,
    })

    const result = await getDeploymentsWithStatusChangesForApps([appId], repositoryId)
    expect(result).toEqual([])
  })

  it('returns the current app identity from monitored_applications, not the stale deployment snapshot', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-shfd-renamed',
      appName: 'app-shfd-renamed',
      environment: 'prod',
    })
    const repositoryId = await linkAppToRepo({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfd',
      githubRepoId: '910004',
    })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-shfd-old',
      appName: 'app-shfd-old',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shfd',
    })
    await seedTransition({
      deploymentId,
      fromStatus: null,
      toStatus: 'pending',
      changeSource: 'nais_sync',
      createdAt: IN_PERIOD,
    })
    await seedTransition({
      deploymentId,
      fromStatus: 'pending',
      toStatus: 'approved',
      changeSource: 'github_verify',
      createdAt: new Date(IN_PERIOD.getTime() + 1000),
    })

    const result = await getDeploymentsWithStatusChangesForApps([appId], repositoryId)
    expect(result).toHaveLength(1)
    expect(result[0].team_slug).toBe('team-shfd-renamed')
    expect(result[0].app_name).toBe('app-shfd-renamed')
  })

  it('excludes deployments detected from a different repository than the requested repositoryId (moved app)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-shfe', appName: 'app-shfe', environment: 'prod' })
    const oldRepoId = await linkAppToRepo({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfe-old',
      githubRepoId: '910005',
      status: 'historical',
    })
    await linkAppToRepo({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfe-new',
      githubRepoId: '910006',
      status: 'active',
    })

    const deploymentInNewRepo = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-shfe',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shfe-new',
    })
    await seedTransition({
      deploymentId: deploymentInNewRepo,
      fromStatus: null,
      toStatus: 'pending',
      changeSource: 'nais_sync',
      createdAt: IN_PERIOD,
    })
    await seedTransition({
      deploymentId: deploymentInNewRepo,
      fromStatus: 'pending',
      toStatus: 'approved',
      changeSource: 'github_verify',
      createdAt: new Date(IN_PERIOD.getTime() + 1000),
    })

    const result = await getDeploymentsWithStatusChangesForApps([appId], oldRepoId)
    expect(result).toEqual([])
  })

  it('returns an empty array when given an empty app ID list', async () => {
    const result = await getDeploymentsWithStatusChangesForApps([], 1)
    expect(result).toEqual([])
  })

  it('excludes a deployment whose owner/name text matches this repo but whose own github_repo_id points elsewhere (name reuse)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-shfr', appName: 'app-shfr', environment: 'prod' })
    const currentRepoId = await linkAppToRepo({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfr-reused',
      githubRepoId: '910007',
    })

    const staleDeployment = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-shfr',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shfr-reused',
      githubRepoId: '999999',
    })
    await seedTransition({
      deploymentId: staleDeployment,
      fromStatus: null,
      toStatus: 'pending',
      changeSource: 'nais_sync',
      createdAt: IN_PERIOD,
    })
    await seedTransition({
      deploymentId: staleDeployment,
      fromStatus: 'pending',
      toStatus: 'approved',
      changeSource: 'github_verify',
      createdAt: new Date(IN_PERIOD.getTime() + 1000),
    })

    const result = await getDeploymentsWithStatusChangesForApps([appId], currentRepoId)
    expect(result).toEqual([])
  })

  it('includes a deployment matched by its own github_repo_id even without owner/name matching (defense in depth)', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-shfs', appName: 'app-shfs', environment: 'prod' })
    const repositoryId = await linkAppToRepo({
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepoName: 'repo-shfs',
      githubRepoId: '910008',
    })

    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-shfs',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shfs',
      githubRepoId: '910008',
    })
    await seedTransition({
      deploymentId,
      fromStatus: null,
      toStatus: 'pending',
      changeSource: 'nais_sync',
      createdAt: IN_PERIOD,
    })
    await seedTransition({
      deploymentId,
      fromStatus: 'pending',
      toStatus: 'approved',
      changeSource: 'github_verify',
      createdAt: new Date(IN_PERIOD.getTime() + 1000),
    })

    const result = await getDeploymentsWithStatusChangesForApps([appId], repositoryId)
    expect(result).toHaveLength(1)
    expect(result[0].deployment_id).toBe(deploymentId)
  })

  it('includes a deployment matched via its own github_repo_id even when the app-repository link is not yet hydrated with an id', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-shft', appName: 'app-shft', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'repo-shft',
      githubRepoId: undefined,
      status: 'active',
    })
    const repositoryId = await seedRepository(pool, {
      githubRepoId: '910009',
      githubOwner: 'navikt',
      githubRepoName: 'repo-shft',
    })

    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-shft',
      environment: 'prod',
      createdAt: IN_PERIOD,
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-shft',
      githubRepoId: '910009',
    })
    await seedTransition({
      deploymentId,
      fromStatus: null,
      toStatus: 'pending',
      changeSource: 'nais_sync',
      createdAt: IN_PERIOD,
    })
    await seedTransition({
      deploymentId,
      fromStatus: 'pending',
      toStatus: 'approved',
      changeSource: 'github_verify',
      createdAt: new Date(IN_PERIOD.getTime() + 1000),
    })

    const result = await getDeploymentsWithStatusChangesForApps([appId], repositoryId)
    expect(result).toHaveLength(1)
    expect(result[0].deployment_id).toBe(deploymentId)
  })
})
