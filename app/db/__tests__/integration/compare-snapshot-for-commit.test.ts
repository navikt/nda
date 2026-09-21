import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getCompareSnapshotForCommit } from '~/db/verification-diff.server'
import { truncateAllTables } from './helpers'

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

async function insertSnapshot(
  pool: Pool,
  args: { owner: string; repo: string; baseSha: string; headSha: string; fetchedAt: Date },
): Promise<void> {
  await pool.query(
    `INSERT INTO github_compare_snapshots (owner, repo, base_sha, head_sha, schema_version, fetched_at, data)
     VALUES ($1, $2, $3, $4, 1, $5, $6)`,
    [args.owner, args.repo, args.baseSha, args.headSha, args.fetchedAt, JSON.stringify({ commits: [], compare: {} })],
  )
}

describe('getCompareSnapshotForCommit', () => {
  const owner = 'navikt'
  const repo = 'pensjon-regler'

  it('returns the real previous...current diff snapshot even when a newer self-compare pollutes the cache', async () => {
    const headSha = 'dbb9f0ec504cd1347178bae9eb0510df0f36fdd8'
    const realBaseSha = '82e0cc7f1b215441318811e3b2f93a6d066294d2'

    await insertSnapshot(pool, {
      owner,
      repo,
      baseSha: realBaseSha,
      headSha,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
    })
    await insertSnapshot(pool, {
      owner,
      repo,
      baseSha: headSha,
      headSha,
      fetchedAt: new Date('2026-01-02T00:00:00Z'),
    })

    const result = await getCompareSnapshotForCommit(headSha)

    expect(result?.base_sha).toBe(realBaseSha)
  })

  it('returns null when only a self-compare snapshot exists for the commit', async () => {
    const headSha = '922cf7aa5c2e287add63f3b8ff14785b0126021b'

    await insertSnapshot(pool, {
      owner,
      repo,
      baseSha: headSha,
      headSha,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const result = await getCompareSnapshotForCommit(headSha)

    expect(result).toBeNull()
  })
})
