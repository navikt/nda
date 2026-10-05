import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { seedApp, seedDeployment, seedRepository, truncateAllTables } from './helpers'

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

async function createDeployment(appName = 'app-a', status = 'pending') {
  const appId = await seedApp(pool, { teamSlug: 'team-a', appName, environment: 'prod-gcp' })
  return seedDeployment(pool, {
    monitoredAppId: appId,
    teamSlug: 'team-a',
    appName,
    environment: 'prod-gcp',
    commitSha: 'b'.repeat(40),
    fourEyesStatus: status,
  })
}

async function createDelivery() {
  const repositoryId = await seedRepository(pool, {
    githubRepoId: '123',
    githubOwner: 'navikt',
    githubRepoName: 'repo-a',
  })
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha)
     VALUES ($1, $2, $3) RETURNING id`,
    [repositoryId, 'a'.repeat(40), 'b'.repeat(40)],
  )
  return { repositoryId, deliveryId: rows[0].id }
}

describe('deployment code delivery link storage', () => {
  it('adds an empty link and index without changing existing data', async () => {
    await createDeployment('app-a', 'manually_approved')
    await createDelivery()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE deployments DROP COLUMN repository_code_delivery_id')
      const deploymentsBefore = await client.query('SELECT to_jsonb(d) AS data FROM deployments d ORDER BY id')
      const deliveriesBefore = await client.query('SELECT to_jsonb(d) AS data FROM repository_code_deliveries d')
      await client.query(
        readFileSync('app/db/migrations/1791219771634_add-repository-code-delivery-id-to-deployments.sql', 'utf8'),
      )
      expect(
        (
          await client.query(
            "SELECT to_jsonb(d) - 'repository_code_delivery_id' AS data FROM deployments d ORDER BY id",
          )
        ).rows,
      ).toEqual(deploymentsBefore.rows)
      expect((await client.query('SELECT repository_code_delivery_id FROM deployments')).rows).toEqual([
        { repository_code_delivery_id: null },
      ])
      expect((await client.query('SELECT to_jsonb(d) AS data FROM repository_code_deliveries d')).rows).toEqual(
        deliveriesBefore.rows,
      )
      const { rows: indexes } = await client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'deployments'
           AND indexname = 'idx_deployments_repository_code_delivery'`,
      )
      expect(indexes).toHaveLength(1)
      expect(indexes[0].indexdef).toContain('(repository_code_delivery_id)')
      expect(indexes[0].indexdef).toContain('WHERE (repository_code_delivery_id IS NOT NULL)')
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
    }
  })

  it('allows deployments from different apps to reference the same delivery without changing their statuses', async () => {
    const firstDeploymentId = await createDeployment('app-a', 'manually_approved')
    const secondDeploymentId = await createDeployment('app-b', 'pending')
    const { repositoryId, deliveryId } = await createDelivery()
    await pool.query(
      `UPDATE deployments SET repository_id = $1, repository_code_delivery_id = $2
       WHERE id = ANY($3)`,
      [repositoryId, deliveryId, [firstDeploymentId, secondDeploymentId]],
    )
    const { rows } = await pool.query(
      `SELECT id, app_name, four_eyes_status, repository_code_delivery_id
       FROM deployments WHERE repository_code_delivery_id = $1 ORDER BY id`,
      [deliveryId],
    )
    expect(rows).toEqual([
      {
        id: firstDeploymentId,
        app_name: 'app-a',
        four_eyes_status: 'manually_approved',
        repository_code_delivery_id: deliveryId,
      },
      {
        id: secondDeploymentId,
        app_name: 'app-b',
        four_eyes_status: 'pending',
        repository_code_delivery_id: deliveryId,
      },
    ])
  })

  it('rejects unknown delivery references and leaves the link empty', async () => {
    const deploymentId = await createDeployment()
    await expect(
      pool.query('UPDATE deployments SET repository_code_delivery_id = $1 WHERE id = $2', [2147483647, deploymentId]),
    ).rejects.toMatchObject({ code: '23503' })
    expect(
      (await pool.query('SELECT repository_code_delivery_id FROM deployments WHERE id = $1', [deploymentId])).rows,
    ).toEqual([{ repository_code_delivery_id: null }])
  })

  it('prevents deleting a referenced delivery without deleting deployments', async () => {
    const deploymentId = await createDeployment()
    const { repositoryId, deliveryId } = await createDelivery()
    await pool.query('UPDATE deployments SET repository_id = $1, repository_code_delivery_id = $2 WHERE id = $3', [
      repositoryId,
      deliveryId,
      deploymentId,
    ])
    await expect(
      pool.query('DELETE FROM repository_code_deliveries WHERE id = $1', [deliveryId]),
    ).rejects.toMatchObject({
      code: '23503',
    })
    expect(
      (await pool.query('SELECT repository_code_delivery_id FROM deployments WHERE id = $1', [deploymentId])).rows,
    ).toEqual([{ repository_code_delivery_id: deliveryId }])
    await pool.query('DELETE FROM deployments WHERE id = $1', [deploymentId])
    expect((await pool.query('SELECT id FROM repository_code_deliveries WHERE id = $1', [deliveryId])).rows).toEqual([
      { id: deliveryId },
    ])
  })
})
