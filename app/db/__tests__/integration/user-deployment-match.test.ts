import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getUnlinkedDependabotDeploymentIds } from '../../deployment-goal-links.server'
import { getPersonalDeploymentsMissingGoalLinks } from '../../deployments/home.server'
import {
  getDeployerApps,
  getDeployerDeploymentsPaginated,
  getDeployerMonthlyStats,
  getDeploymentCountByDeployer,
} from '../../deployments.server'
import { seedApp, seedDeployment, truncateAllTables } from './helpers'

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

describe('user deployment match — deployer ELLER PR-skaper, case-insensitive', () => {
  async function seedScenario() {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const now = new Date('2026-03-15T10:00:00Z')
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'pcmoen',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'PCMOEN',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'github-actions[bot]',
      githubPrData: { creator: { username: 'pcmoen' } },
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'someoneelse',
      githubPrData: { creator: { username: 'someoneelse' } },
    })
    return appId
  }

  it('getDeploymentCountByDeployer matcher deployer + PR-skaper case-insensitivt', async () => {
    await seedScenario()
    expect(await getDeploymentCountByDeployer('pcmoen')).toBe(3)
  })

  it('getDeployerDeploymentsPaginated matcher deployer + PR-skaper case-insensitivt', async () => {
    await seedScenario()
    const result = await getDeployerDeploymentsPaginated('pcmoen', 1, 20)
    expect(result.total).toBe(3)
  })

  it('getDeployerMonthlyStats matcher deployer + PR-skaper case-insensitivt', async () => {
    await seedScenario()
    const rows = await getDeployerMonthlyStats('pcmoen')
    const total = rows.reduce((sum, r) => sum + r.total, 0)
    expect(total).toBe(3)
  })

  it('getDeployerApps matcher deployer + PR-skaper case-insensitivt', async () => {
    await seedScenario()
    const apps = await getDeployerApps('pcmoen')
    expect(apps).toEqual(['app-a'])
  })

  it('getPersonalDeploymentsMissingGoalLinks matcher deployer + PR-skaper case-insensitivt', async () => {
    await seedScenario()
    expect(await getPersonalDeploymentsMissingGoalLinks('pcmoen')).toBe(3)
  })

  it('getUnlinkedDependabotDeploymentIds matcher PR-skaper når dependabot deployer', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: 2026,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2026-03-15T10:00:00Z'),
      deployerUsername: 'github-actions[bot]',
      githubPrData: { creator: { username: 'dependabot[bot]' } },
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2026-03-15T10:00:00Z'),
      deployerUsername: 'pcmoen',
      githubPrData: { creator: { username: 'dependabot[bot]' } },
    })
    const ids = await getUnlinkedDependabotDeploymentIds('pcmoen')
    expect(ids.length).toBe(1)
  })

  it('matcher deployments med NULL eller manglende github_pr_data via deployer', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const now = new Date('2026-03-15T10:00:00Z')
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'pcmoen',
      githubPrData: null,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'pcmoen',
      githubPrData: {},
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'pcmoen',
      githubPrData: { creator: {} },
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'github-actions[bot]',
      githubPrData: null,
    })
    expect(await getDeploymentCountByDeployer('pcmoen')).toBe(3)
  })
})

describe('user deployment match — team-aggregate queries', () => {
  it('getDevTeamCoverageStats matcher team-medlem som PR-skaper også', async () => {
    const { getDevTeamCoverageStats } = await import('../../deployment-goal-links.server')
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const now = new Date('2026-03-15T10:00:00Z')
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'alice',
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'github-actions[bot]',
      githubPrData: { creator: { username: 'alice' } },
      fourEyesStatus: 'approved',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'someoneelse',
      fourEyesStatus: 'approved',
    })

    const result = await getDevTeamCoverageStats([appId], ['ALICE'], new Date('2026-01-01'), new Date('2027-01-01'))
    expect(result.total).toBe(2)
  })

  it('getAppDeploymentStatsBatch matcher team-medlem som PR-skaper også', async () => {
    const { getAppDeploymentStatsBatch } = await import('../../deployments/stats.server')
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const now = new Date('2026-03-15T10:00:00Z')
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: now,
      deployerUsername: 'github-actions[bot]',
      githubPrData: { creator: { username: 'alice' } },
    })

    const stats = await getAppDeploymentStatsBatch([{ id: appId }], ['ALICE'])
    expect(stats.get(appId)?.total).toBe(2)
  })
})
