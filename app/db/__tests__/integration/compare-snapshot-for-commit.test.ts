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

    const result = await getCompareSnapshotForCommit(owner, repo, headSha)

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

    const result = await getCompareSnapshotForCommit(owner, repo, headSha)

    expect(result).toBeNull()
  })

  it('ignores snapshots from a different repository sharing the same head_sha', async () => {
    const headSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d'
    const realBaseSha = 'f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d'

    await insertSnapshot(pool, {
      owner,
      repo: 'other-repo',
      baseSha: realBaseSha,
      headSha,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const result = await getCompareSnapshotForCommit(owner, repo, headSha)

    expect(result).toBeNull()
  })

  it('returns the exact base_sha match when an expected base commit is provided, including self-compares', async () => {
    const headSha = 'bb11cc22dd33ee44ff550011223344556677889a'
    const expectedBaseSha = headSha

    await insertSnapshot(pool, {
      owner,
      repo,
      baseSha: expectedBaseSha,
      headSha,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const result = await getCompareSnapshotForCommit(owner, repo, headSha, expectedBaseSha)

    expect(result?.base_sha).toBe(expectedBaseSha)
  })

  it('returns null when the only cached snapshot does not match the expected base commit', async () => {
    const headSha = 'cc22dd33ee44ff55001122334455667788990a1b'

    await insertSnapshot(pool, {
      owner,
      repo,
      baseSha: 'unrelated-base-sha',
      headSha,
      fetchedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const result = await getCompareSnapshotForCommit(owner, repo, headSha, 'expected-base-sha')

    expect(result).toBeNull()
  })
})
