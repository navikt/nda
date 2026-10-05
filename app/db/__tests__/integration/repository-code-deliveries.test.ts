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

async function createRepository(githubRepoId = '123') {
  return seedRepository(pool, {
    githubRepoId,
    githubOwner: 'navikt',
    githubRepoName: `repo-${githubRepoId}`,
  })
}

describe('repository code delivery storage', () => {
  it('adds empty storage without changing existing deployments or repositories', async () => {
    const repositoryId = await createRepository()
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-gcp' })
    await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod-gcp',
      commitSha: 'b'.repeat(40),
      fourEyesStatus: 'manually_approved',
    })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE deployments DROP COLUMN repository_code_delivery_id')
      await client.query('DROP TABLE repository_code_deliveries')
      const deploymentsBefore = await client.query('SELECT to_jsonb(d) AS data FROM deployments d ORDER BY id')
      const repositoryBefore = await client.query('SELECT to_jsonb(r) AS data FROM repositories r WHERE id = $1', [
        repositoryId,
      ])
      await client.query(readFileSync('app/db/migrations/1791215149449_add-repository-code-deliveries.sql', 'utf8'))
      expect((await client.query('SELECT * FROM repository_code_deliveries')).rows).toEqual([])
      expect((await client.query('SELECT to_jsonb(d) AS data FROM deployments d ORDER BY id')).rows).toEqual(
        deploymentsBefore.rows,
      )
      expect(
        (await client.query('SELECT to_jsonb(r) AS data FROM repositories r WHERE id = $1', [repositoryId])).rows,
      ).toEqual(repositoryBefore.rows)
    } finally {
      try {
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
    }
  })

  it('stores full SHA values and creation time without normalizing their case', async () => {
    const repositoryId = await createRepository()
    const { rows } = await pool.query(
      `INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha)
       VALUES ($1, $2, $3) RETURNING *`,
      [repositoryId, 'A'.repeat(40), 'B'.repeat(40)],
    )
    expect(rows[0]).toMatchObject({
      repository_id: repositoryId,
      base_sha: 'A'.repeat(40),
      head_sha: 'B'.repeat(40),
    })
    expect(rows[0].id).toBeGreaterThan(0)
    expect(rows[0].created_at).toBeInstanceOf(Date)
  })

  it.each([null, '', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), `${'a'.repeat(39)}\n`])(
    'rejects invalid interval endpoint %j',
    async (sha) => {
      const repositoryId = await createRepository()
      for (const [base, head] of [
        [sha, 'b'.repeat(40)],
        ['a'.repeat(40), sha],
      ]) {
        await expect(
          pool.query('INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha) VALUES ($1, $2, $3)', [
            repositoryId,
            base,
            head,
          ]),
        ).rejects.toThrow()
      }
    },
  )

  it('allows one head per repository regardless of hexadecimal case', async () => {
    const repositoryId = await createRepository()
    const otherRepositoryId = await createRepository('456')
    await pool.query('INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha) VALUES ($1, $2, $3)', [
      repositoryId,
      'a'.repeat(40),
      'b'.repeat(40),
    ])
    for (const head of ['b'.repeat(40), 'B'.repeat(40)]) {
      await expect(
        pool.query('INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha) VALUES ($1, $2, $3)', [
          repositoryId,
          'c'.repeat(40),
          head,
        ]),
      ).rejects.toMatchObject({ code: '23505' })
    }
    await pool.query('INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha) VALUES ($1, $2, $3)', [
      otherRepositoryId,
      'a'.repeat(40),
      'b'.repeat(40),
    ])
  })

  it('requires repository identity and prevents deleting referenced repositories', async () => {
    for (const repositoryId of [null, -1]) {
      await expect(
        pool.query('INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha) VALUES ($1, $2, $3)', [
          repositoryId,
          'a'.repeat(40),
          'b'.repeat(40),
        ]),
      ).rejects.toMatchObject({ code: repositoryId === null ? '23502' : '23503' })
    }
    const repositoryId = await createRepository()
    await pool.query('INSERT INTO repository_code_deliveries (repository_id, base_sha, head_sha) VALUES ($1, $2, $3)', [
      repositoryId,
      'a'.repeat(40),
      'b'.repeat(40),
    ])
    await expect(pool.query('DELETE FROM repositories WHERE id = $1', [repositoryId])).rejects.toMatchObject({
      code: '23503',
    })
    expect((await pool.query('SELECT count(*)::integer AS count FROM repository_code_deliveries')).rows[0].count).toBe(
      1,
    )
  })
})
