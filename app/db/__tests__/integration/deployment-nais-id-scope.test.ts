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
  it('prevents one app from reusing another app deployment while the database migration is pending', async () => {
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
    expect((await getDeploymentByNaisId(sharedNaisDeploymentId, firstAppId))?.id).toBe(firstDeployment.id)
    expect(await getDeploymentByNaisId(sharedNaisDeploymentId, secondAppId)).toBeNull()
    await expect(
      createDeployment({
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
      }),
    ).rejects.toThrow('already stored for a different monitored application')
    const preservedFirstDeployment = await pool.query(
      'SELECT monitored_app_id, resources FROM deployments WHERE id = $1',
      [firstDeployment.id],
    )
    expect(preservedFirstDeployment.rows[0]).toEqual({
      monitored_app_id: firstAppId,
      resources: { refreshed: true },
    })

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
    ).rejects.toThrow(`for monitored application ${secondAppId}`)
  })
})
