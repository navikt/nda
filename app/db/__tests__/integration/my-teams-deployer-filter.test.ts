import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getDevTeamAppsWithIssues } from '~/db/deployments/home.server'
import { seedApp, truncateAllTables } from './helpers'

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

async function seedDeployment(
  monitoredAppId: number,
  teamSlug: string,
  fourEyesStatus: string,
  deployerUsername: string,
): Promise<number> {
  const naisId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO deployments (
       monitored_app_id, nais_deployment_id, team_slug, app_name, environment_name,
       commit_sha, created_at, four_eyes_status, deployer_username
     ) VALUES ($1, $2, $3, 'app', 'prod', $4, NOW(), $5, $6)
     RETURNING id`,
    [monitoredAppId, naisId, teamSlug, `sha-${naisId}`, fourEyesStatus, deployerUsername],
  )
  return rows[0].id
}

describe('getDevTeamAppsWithIssues deployer filter', () => {
  it('app-scope (no filter) counts every deployment regardless of deployer', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'svc', environment: 'prod' })
    await seedDeployment(appId, 'team-x', 'direct_push', 'alice')
    await seedDeployment(appId, 'team-x', 'direct_push', 'bob')
    await seedDeployment(appId, 'team-x', 'direct_push', 'outsider')

    const apps = await getDevTeamAppsWithIssues(['team-x'])
    expect(apps).toHaveLength(1)
    expect(apps[0].without_four_eyes).toBe(3)
  })

  it('person-scope restricts deployment counts to the given GitHub usernames', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'svc', environment: 'prod' })
    await seedDeployment(appId, 'team-x', 'direct_push', 'alice')
    await seedDeployment(appId, 'team-x', 'direct_push', 'bob')
    await seedDeployment(appId, 'team-x', 'direct_push', 'outsider')

    const apps = await getDevTeamAppsWithIssues(['team-x'], undefined, ['alice', 'bob'])
    expect(apps).toHaveLength(1)
    expect(apps[0].without_four_eyes).toBe(2)
  })

  it('person-scope filters missing_goal_links the same way', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'svc', environment: 'prod' })
    await seedDeployment(appId, 'team-x', 'approved_pr', 'alice')
    await seedDeployment(appId, 'team-x', 'approved_pr', 'alice')
    await seedDeployment(appId, 'team-x', 'approved_pr', 'outsider')

    const personScope = await getDevTeamAppsWithIssues(['team-x'], undefined, ['alice'])
    expect(personScope[0].missing_goal_links).toBe(2)

    const appScope = await getDevTeamAppsWithIssues(['team-x'])
    expect(appScope[0].missing_goal_links).toBe(3)
  })

  it('empty deployerUsernames array yields zero deployment counts', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-x', appName: 'svc', environment: 'prod' })
    await seedDeployment(appId, 'team-x', 'direct_push', 'alice')
    await pool.query(
      `INSERT INTO repository_alerts (monitored_app_id, new_owner, new_repo, status)
       VALUES ($1, 'navikt', 'svc', 'open')`,
      [appId],
    )

    const apps = await getDevTeamAppsWithIssues(['team-x'], undefined, [])
    expect(apps).toHaveLength(1)
    expect(apps[0].without_four_eyes).toBe(0)
    expect(apps[0].missing_goal_links).toBe(0)
    expect(apps[0].alert_count).toBe(1)
  })
})
