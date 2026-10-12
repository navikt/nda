import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createRepositoryAlert } from '~/db/alerts.server'
import { closePool } from '~/db/connection.server'
import { createDeployment, getDeploymentByNaisId } from '~/db/deployments.server'
import { seedApp, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await closePool()
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

describe('Nais deployment IDs scoped to monitored applications', () => {
  it('allows shared IDs across apps and keeps deployment processing idempotent per app', async () => {
    const firstAppId = await seedApp(pool, {
      teamSlug: 'team-a',
      appName: 'app-a',
      environment: 'prod-gcp',
    })
    const secondAppId = await seedApp(pool, {
      teamSlug: 'team-b',
      appName: 'app-b',
      environment: 'prod-gcp',
    })
    const sharedNaisDeploymentId = 'shared-nais-deployment-id'

    const firstDeployment = await createDeployment({
      monitoredApplicationId: firstAppId,
      naisDeploymentId: sharedNaisDeploymentId,
      createdAt: new Date('2026-10-11T12:00:00Z'),
      teamSlug: 'team-a',
      environmentName: 'prod-gcp',
      appName: 'app-a',
      deployerUsername: null,
      commitSha: 'a'.repeat(40),
      triggerUrl: null,
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'shared-repo',
    })
    const repeatedFirstDeployment = await createDeployment({
      monitoredApplicationId: firstAppId,
      naisDeploymentId: sharedNaisDeploymentId,
      createdAt: new Date('2026-10-11T12:00:00Z'),
      teamSlug: 'team-a',
      environmentName: 'prod-gcp',
      appName: 'app-a',
      deployerUsername: null,
      commitSha: 'a'.repeat(40),
      triggerUrl: null,
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'shared-repo',
      resources: { refreshed: true },
    })

    expect(repeatedFirstDeployment.id).toBe(firstDeployment.id)
    expect(repeatedFirstDeployment.resources).toEqual({ refreshed: true })
    expect((await getDeploymentByNaisId(sharedNaisDeploymentId, firstAppId))?.id).toBe(firstDeployment.id)
    const secondDeployment = await createDeployment({
      monitoredApplicationId: secondAppId,
      naisDeploymentId: sharedNaisDeploymentId,
      createdAt: new Date('2026-10-11T12:01:00Z'),
      teamSlug: 'team-b',
      environmentName: 'prod-gcp',
      appName: 'app-b',
      deployerUsername: null,
      commitSha: 'b'.repeat(40),
      triggerUrl: null,
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'shared-repo',
    })
    expect(secondDeployment.id).not.toBe(firstDeployment.id)
    expect((await getDeploymentByNaisId(sharedNaisDeploymentId, secondAppId))?.id).toBe(secondDeployment.id)

    await expect(
      createRepositoryAlert({
        monitoredApplicationId: secondAppId,
        deploymentNaisId: sharedNaisDeploymentId,
        detectedGithubOwner: 'navikt',
        detectedGithubRepoName: 'new-repo',
        expectedGithubOwner: 'navikt',
        expectedGithubRepoName: 'expected-repo',
        alertType: 'pending_approval',
      }),
    ).resolves.toBe(true)
    const alert = await pool.query('SELECT deployment_id FROM repository_alerts WHERE monitored_app_id = $1', [
      secondAppId,
    ])
    expect(alert.rows).toEqual([{ deployment_id: secondDeployment.id }])
  })
})
