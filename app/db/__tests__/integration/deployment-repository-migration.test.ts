import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closePool } from '~/db/connection.server'
import { createDeployment } from '~/db/deployments.server'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

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

describe('deployment repository migration', () => {
  it('preserves existing deployment data when adding the nullable reference', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const deploymentId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'a'.repeat(40),
      fourEyesStatus: 'manually_approved',
      githubOwner: 'navikt',
      githubRepo: 'repo-a',
    })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE deployments DROP COLUMN repository_id')
      const before = await client.query('SELECT to_jsonb(d) AS data FROM deployments d WHERE id = $1', [deploymentId])
      await client.query(readFileSync('app/db/migrations/1791141179383_add-repository-id-to-deployments.sql', 'utf8'))
      const after = await client.query('SELECT to_jsonb(d) AS data FROM deployments d WHERE id = $1', [deploymentId])
      expect(after.rows[0].data).toEqual({ ...before.rows[0].data, repository_id: null })
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
    }
  })

  it('keeps existing inserts and upserts compatible and enforces reference integrity', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    const params = {
      monitoredApplicationId: appId,
      naisDeploymentId: 'deployment-a',
      createdAt: new Date('2026-10-04T12:00:00Z'),
      teamSlug: 'team-a',
      environmentName: 'prod-gcp',
      appName: 'app-a',
      commitSha: 'a'.repeat(40),
      deployerUsername: null,
      triggerUrl: null,
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'repo-a',
    }
    const deployment = await createDeployment(params)
    const inserted = await pool.query('SELECT repository_id FROM deployments WHERE id = $1', [deployment.id])
    expect(inserted.rows[0].repository_id).toBeNull()

    const repositoryId = await seedRepository(pool, {
      githubRepoId: '123',
      githubOwner: 'navikt',
      githubRepoName: 'repo-a',
    })
    await pool.query('UPDATE deployments SET repository_id = $1 WHERE id = $2', [repositoryId, deployment.id])
    await createDeployment({ ...params, resources: { updated: true } })
    const updated = await pool.query('SELECT repository_id, resources FROM deployments WHERE id = $1', [deployment.id])
    expect(updated.rows[0]).toEqual({ repository_id: repositoryId, resources: { updated: true } })
    await expect(
      pool.query('UPDATE deployments SET repository_id = -1 WHERE id = $1', [deployment.id]),
    ).rejects.toMatchObject({ code: '23503' })
    await expect(pool.query('DELETE FROM repositories WHERE id = $1', [repositoryId])).rejects.toMatchObject({
      code: '23503',
    })
    const retained = await pool.query('SELECT repository_id FROM deployments WHERE id = $1', [deployment.id])
    expect(retained.rows[0].repository_id).toBe(repositoryId)
  })
})
