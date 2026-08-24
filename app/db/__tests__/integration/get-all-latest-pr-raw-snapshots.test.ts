import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getAllLatestPrRawSnapshots, savePrRawSnapshotsBatch } from '~/db/github-data.server'
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

const apiVersion = { apiVersion: '2022-11-28', apiDeprecatedAt: null, apiSunsetAt: null }

describe('getAllLatestPrRawSnapshots', () => {
  it('returns only the latest repository id complete set when a repo has been deleted and recreated', async () => {
    await savePrRawSnapshotsBatch('navikt', 'nda', 100, 111, apiVersion, [
      { dataType: 'pr', data: { title: 'Old PR' } },
      { dataType: 'reviews', data: [{ id: 1 }] },
      { dataType: 'commits', data: [{ sha: 'old' }] },
    ])

    await savePrRawSnapshotsBatch('navikt', 'nda', 100, 222, apiVersion, [
      { dataType: 'pr', data: { title: 'New PR' } },
      { dataType: 'reviews', data: [{ id: 2 }] },
      { dataType: 'commits', data: [{ sha: 'new' }] },
    ])

    const result = await getAllLatestPrRawSnapshots('navikt', 'nda', 100)

    expect(result.size).toBe(3)
    expect(result.get('pr')?.data).toEqual({ title: 'New PR' })
    expect(result.get('reviews')?.data).toEqual([{ id: 2 }])
    expect(result.get('commits')?.data).toEqual([{ sha: 'new' }])
    for (const snapshot of result.values()) {
      expect(snapshot.githubRepoId).toBe(222)
    }
  })

  it('returns the latest fetch per data type within the current repository id', async () => {
    await savePrRawSnapshotsBatch('navikt', 'nda', 100, 111, apiVersion, [
      { dataType: 'pr', data: { title: 'First fetch' } },
    ])
    await savePrRawSnapshotsBatch('navikt', 'nda', 100, 111, apiVersion, [
      { dataType: 'pr', data: { title: 'Second fetch' } },
    ])

    const result = await getAllLatestPrRawSnapshots('navikt', 'nda', 100)

    expect(result.get('pr')?.data).toEqual({ title: 'Second fetch' })
  })

  it('returns an empty map when no snapshots exist', async () => {
    const result = await getAllLatestPrRawSnapshots('navikt', 'nda', 999)

    expect(result.size).toBe(0)
  })
})
