import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { checkAuditReadiness } from '../../audit-reports.server'
import { getSectionDashboardStats, getSectionOverallStats } from '../../dashboard-stats.server'
import {
  getDevTeamCoverageStats,
  getOriginOfChangeCoverage,
  getUnlinkedDependabotDeploymentIds,
} from '../../deployment-goal-links.server'
import { getUnapprovedDeployments } from '../../deployments/notifications.server'
import {
  getDeployerApps,
  getDeployerDeploymentsPaginated,
  getDeployerMonthlyStats,
  getDeploymentCountByDeployer,
} from '../../deployments.server'
import { createDeviation, getDeviationsByAppId, getDeviationsForPeriod } from '../../deviations.server'
import { seedApp, seedDeployment, seedDevTeam, seedSection, truncateAllTables } from './helpers'

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

const PRE_YEAR = new Date('2024-06-15T10:00:00Z')
const POST_YEAR = new Date('2026-06-15T10:00:00Z')

describe('audit_start_year filter — grenseverdier', () => {
  it('inkluderer deployment ved nøyaktig audit_start_year-grensen (2026-01-01 00:00:00Z)', async () => {
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
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: new Date('2025-12-31T23:59:59.999Z'),
      deployerUsername: 'alice',
    })

    const count = await getDeploymentCountByDeployer('alice')
    expect(count).toBe(1)
  })
})

describe('audit_start_year filter — deployer queries', () => {
  it('getDeploymentCountByDeployer ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      deployerUsername: 'alice',
    })

    expect(await getDeploymentCountByDeployer('alice')).toBe(1)
  })

  it('getDeploymentCountByDeployer teller alle når audit_start_year er null', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: null,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: PRE_YEAR,
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      deployerUsername: 'alice',
    })

    expect(await getDeploymentCountByDeployer('alice')).toBe(2)
  })

  it('getDeployerMonthlyStats ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      deployerUsername: 'alice',
    })

    const stats = await getDeployerMonthlyStats('alice', new Date('2024-01-01'), new Date('2027-01-01'))
    const total = stats.reduce((sum, m) => sum + m.total, 0)
    expect(total).toBe(1)
  })

  it('getDeployerDeploymentsPaginated med without_goal-filter ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      deployerUsername: 'alice',
    })

    const result = await getDeployerDeploymentsPaginated('alice', 1, 20, null, null, {
      goal: 'without_goal',
    })
    expect(result.total).toBe(1)
    expect(result.deployments).toHaveLength(1)
  })
})

describe('audit_start_year filter — Slack reminder query', () => {
  it('getUnapprovedDeployments ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
      fourEyesStatus: 'unverified_commits',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      fourEyesStatus: 'unverified_commits',
    })

    const result = await getUnapprovedDeployments(appId)
    expect(result).toHaveLength(1)
  })
})

describe('audit_start_year filter — coverage queries', () => {
  it('getOriginOfChangeCoverage (directApps) ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
    })

    const result = await getOriginOfChangeCoverage([], new Date('2024-01-01'), new Date('2027-01-01'), [appId])
    expect(result.total).toBe(1)
  })

  it('getOriginOfChangeCoverage (naisTeamSlugs) ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
    })

    const result = await getOriginOfChangeCoverage(['team-a'], new Date('2024-01-01'), new Date('2027-01-01'))
    expect(result.total).toBe(1)
  })

  it('getDevTeamCoverageStats ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      deployerUsername: 'alice',
    })

    const result = await getDevTeamCoverageStats([appId], ['alice'], new Date('2024-01-01'), new Date('2027-01-01'))
    expect(result.total).toBe(1)
  })
})

describe('audit_start_year filter — Dependabot link query', () => {
  it('getUnlinkedDependabotDeploymentIds ekskluderer pre-revisjons-deployments', async () => {
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
      createdAt: PRE_YEAR,
      deployerUsername: 'alice',
      githubPrData: { creator: { username: 'dependabot[bot]' } },
    })
    const postId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      deployerUsername: 'alice',
      githubPrData: { creator: { username: 'dependabot[bot]' } },
    })

    const ids = await getUnlinkedDependabotDeploymentIds('alice')
    expect(ids).toEqual([postId])
  })
})

describe('audit_start_year filter — deviations queries', () => {
  it('getDeviationsByAppId ekskluderer avvik knyttet til pre-revisjons-deployments', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const preDep = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: PRE_YEAR,
    })
    const postDep = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
    })
    await createDeviation({ deployment_id: preDep, reason: 'pre', registered_by: 'tester' })
    await createDeviation({ deployment_id: postDep, reason: 'post', registered_by: 'tester' })

    const result = await getDeviationsByAppId(appId)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('post')
  })

  it('getDeviationsForPeriod ekskluderer avvik knyttet til pre-revisjons-deployments', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const preDep = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: PRE_YEAR,
    })
    const postDep = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
    })
    await createDeviation({ deployment_id: preDep, reason: 'pre', registered_by: 'tester' })
    await createDeviation({ deployment_id: postDep, reason: 'post', registered_by: 'tester' })

    const result = await getDeviationsForPeriod(appId, new Date('2024-01-01'), new Date('2027-01-01'))
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('post')
  })
})

describe('audit_start_year filter — section dashboard queries', () => {
  it('getSectionOverallStats ekskluderer pre-revisjons-deployments', async () => {
    const sectionId = await seedSection(pool, 'sec-a', 'Section A')
    await pool.query(`INSERT INTO section_teams (section_id, team_slug) VALUES ($1, $2)`, [sectionId, 'team-a'])
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
      createdAt: PRE_YEAR,
      fourEyesStatus: 'direct_push',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      fourEyesStatus: 'direct_push',
    })

    const stats = await getSectionOverallStats(sectionId)
    expect(stats.total_deployments).toBe(1)
    expect(stats.without_four_eyes).toBe(1)
  })

  it('getSectionDashboardStats ekskluderer pre-revisjons-deployments', async () => {
    const sectionId = await seedSection(pool, 'sec-b', 'Section B')
    const devTeamId = await seedDevTeam(pool, 'dev-team-a', 'Dev Team A', sectionId)
    await pool.query(`INSERT INTO dev_team_nais_teams (dev_team_id, nais_team_slug) VALUES ($1, $2)`, [
      devTeamId,
      'team-a',
    ])
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
      createdAt: PRE_YEAR,
      fourEyesStatus: 'direct_push',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: POST_YEAR,
      fourEyesStatus: 'direct_push',
    })

    const rows = await getSectionDashboardStats(sectionId)
    const teamRow = rows.find((r) => r.dev_team_slug === 'dev-team-a')
    expect(teamRow).toBeDefined()
    expect(teamRow?.total_deployments).toBe(1)
    expect(teamRow?.without_four_eyes).toBe(1)
  })
})

describe('audit_start_year filter — audit reports queries', () => {
  it('checkAuditReadiness ekskluderer pre-revisjons-deployments', async () => {
    const appId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod-fss',
      auditStartYear: 2026,
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      createdAt: PRE_YEAR,
      fourEyesStatus: 'direct_push',
    })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-fss',
      createdAt: POST_YEAR,
      fourEyesStatus: 'approved',
    })

    const readiness = await checkAuditReadiness(appId, new Date('2024-01-01'), new Date('2027-01-01'))
    expect(readiness.total_deployments).toBe(1)
  })
})

describe('audit_start_year filter — deployer apps query', () => {
  it('getDeployerApps ekskluderer apper med kun pre-revisjons-deployments', async () => {
    const appA = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-only-pre',
      environment: 'prod',
      auditStartYear: 2026,
    })
    const appB = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-with-post',
      environment: 'prod',
      auditStartYear: 2026,
    })
    await seedDeployment(pool, {
      monitoredAppId: appA,
      teamSlug: 'team-a',
      environment: 'prod',
      createdAt: PRE_YEAR,
      deployerUsername: 'alice',
    })
    await seedDeployment(pool, {
      monitoredAppId: appB,
      teamSlug: 'team-b',
      environment: 'prod',
      createdAt: POST_YEAR,
      deployerUsername: 'alice',
    })

    const apps = await getDeployerApps('alice')
    expect(apps).toEqual(['app-with-post'])
  })
})
