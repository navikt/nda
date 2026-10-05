import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closePool } from '~/db/connection.server'
import {
  createRepositoryCodeDelivery,
  getRepositoryCodeDelivery,
  RepositoryCodeDeliveryConflictError,
} from '~/db/repository-code-deliveries.server'
import { seedRepository, truncateAllTables } from './helpers'

let pool: Pool

const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)

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

async function createRepository(githubRepoId = '123') {
  return seedRepository(pool, {
    githubRepoId,
    githubOwner: 'navikt',
    githubRepoName: `repo-${githubRepoId}`,
  })
}

describe('repository code delivery API', () => {
  it('creates and retrieves an explicit interval', async () => {
    const repositoryId = await createRepository()
    expect(await getRepositoryCodeDelivery(repositoryId, headSha)).toBeNull()
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha })
    expect(delivery).toEqual({
      id: expect.any(Number),
      repository_id: repositoryId,
      base_sha: baseSha,
      head_sha: headSha,
      created_at: expect.any(Date),
    })
    expect(await getRepositoryCodeDelivery(repositoryId, headSha.toUpperCase())).toEqual(delivery)
  })

  it('reuses the original row without changing case or creation time', async () => {
    const repositoryId = await createRepository()
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha })
    expect(
      await createRepositoryCodeDelivery({
        repositoryId,
        baseSha: baseSha.toUpperCase(),
        headSha: headSha.toUpperCase(),
      }),
    ).toEqual(delivery)
    expect((await pool.query('SELECT * FROM repository_code_deliveries')).rows).toEqual([delivery])
  })

  it('rejects another base without modifying the existing delivery', async () => {
    const repositoryId = await createRepository()
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha })
    const requestedBaseSha = 'c'.repeat(40)
    await expect(
      createRepositoryCodeDelivery({ repositoryId, baseSha: requestedBaseSha, headSha: headSha.toUpperCase() }),
    ).rejects.toMatchObject({
      name: 'RepositoryCodeDeliveryConflictError',
      existingDelivery: delivery,
      requestedBaseSha,
    })
    expect(await getRepositoryCodeDelivery(repositoryId, headSha)).toEqual(delivery)
  })

  it('keeps the same head in different repositories separate', async () => {
    const repositoryId = await createRepository()
    const otherRepositoryId = await createRepository('456')
    const delivery = await createRepositoryCodeDelivery({ repositoryId, baseSha, headSha })
    expect(await getRepositoryCodeDelivery(otherRepositoryId, headSha)).toBeNull()
    const otherDelivery = await createRepositoryCodeDelivery({
      repositoryId: otherRepositoryId,
      baseSha: 'c'.repeat(40),
      headSha,
    })
    expect(otherDelivery.id).not.toBe(delivery.id)
    expect(await getRepositoryCodeDelivery(repositoryId, headSha)).toEqual(delivery)
    expect(await getRepositoryCodeDelivery(otherRepositoryId, headSha)).toEqual(otherDelivery)
  })

  it('returns one unchanged delivery for concurrent calls with the same interval', async () => {
    const repositoryId = await createRepository()
    const [first, second, third] = await Promise.all([
      createRepositoryCodeDelivery({ repositoryId, baseSha, headSha }),
      createRepositoryCodeDelivery({ repositoryId, baseSha, headSha }),
      createRepositoryCodeDelivery({ repositoryId, baseSha: baseSha.toUpperCase(), headSha: headSha.toUpperCase() }),
    ])
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect((await pool.query('SELECT * FROM repository_code_deliveries')).rows).toEqual([first])
  })

  it('rejects the losing interval when concurrent calls disagree on base', async () => {
    const repositoryId = await createRepository()
    const [first, second] = await Promise.allSettled([
      createRepositoryCodeDelivery({ repositoryId, baseSha, headSha }),
      createRepositoryCodeDelivery({ repositoryId, baseSha: 'c'.repeat(40), headSha: headSha.toUpperCase() }),
    ])
    const results = [first, second]
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const delivery = await getRepositoryCodeDelivery(repositoryId, headSha)
    for (const result of results) {
      if (result.status === 'fulfilled') {
        expect(delivery).toEqual(result.value)
      } else {
        expect(result.reason).toBeInstanceOf(RepositoryCodeDeliveryConflictError)
        expect(result.reason.existingDelivery).toEqual(delivery)
      }
    }
    expect((await pool.query('SELECT * FROM repository_code_deliveries')).rows).toEqual([delivery])
  })

  it.each(['', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), `${'a'.repeat(39)}\n`])(
    'rejects invalid SHA %j without writing',
    async (sha) => {
      const repositoryId = await createRepository()
      await expect(getRepositoryCodeDelivery(repositoryId, sha)).rejects.toThrow('40 hexadecimal')
      await expect(createRepositoryCodeDelivery({ repositoryId, baseSha: sha, headSha })).rejects.toThrow(
        '40 hexadecimal',
      )
      await expect(createRepositoryCodeDelivery({ repositoryId, baseSha, headSha: sha })).rejects.toThrow(
        '40 hexadecimal',
      )
      expect((await pool.query('SELECT * FROM repository_code_deliveries')).rows).toEqual([])
    },
  )

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid repository ID %j', async (id) => {
    await expect(getRepositoryCodeDelivery(id, headSha)).rejects.toThrow('positive integer')
    await expect(createRepositoryCodeDelivery({ repositoryId: id, baseSha, headSha })).rejects.toThrow(
      'positive integer',
    )
  })

  it('propagates a missing repository error without writing', async () => {
    await expect(createRepositoryCodeDelivery({ repositoryId: 2147483647, baseSha, headSha })).rejects.toMatchObject({
      code: '23503',
    })
    expect((await pool.query('SELECT * FROM repository_code_deliveries')).rows).toEqual([])
  })
})
