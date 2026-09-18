import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const mockClientQuery = vi.fn()
const mockClientRelease = vi.fn()

vi.mock('~/db/connection.server', () => ({
  pool: {
    connect: vi.fn(async () => ({ query: mockClientQuery, release: mockClientRelease })),
  },
}))

import { pool } from '~/db/connection.server'
import { cleanupOldSnapshots } from '~/db/github-data.server'

const mockPoolConnect = pool.connect as Mock

describe('cleanupOldSnapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPoolConnect.mockImplementation(async () => ({ query: mockClientQuery, release: mockClientRelease }))
  })

  it('deletes in batches per table and stops once a batch returns fewer rows than requested', async () => {
    let candidateDeleteCallCount = 0
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 2 }
      if (sql.includes('DELETE FROM snapshot_cleanup_candidates')) {
        candidateDeleteCallCount += 1
        return candidateDeleteCallCount === 1 ? { rows: [{ id: 1 }, { id: 2 }] } : { rows: [] }
      }
      return { rowCount: 2 }
    })

    const result = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90, batchSize: 2, maxRowsPerTable: 10 })

    expect(result.truncated).toBe(false)
    const totalDeleted = Object.values(result.counts).reduce((sum, n) => sum + n, 0)
    expect(totalDeleted).toBe(2)
  })

  it('marks the result as truncated once more candidates exist than maxRowsPerTable', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 3 }
      if (sql.includes('DELETE FROM snapshot_cleanup_candidates')) return { rows: [{ id: 1 }, { id: 2 }] }
      return { rowCount: 2 }
    })

    const result = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90, batchSize: 2, maxRowsPerTable: 2 })

    expect(result.truncated).toBe(true)
  })

  it('does not mark the result as truncated when candidates exactly fill maxRowsPerTable', async () => {
    let candidateDeleteCallCount = 0
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 2 }
      if (sql.includes('DELETE FROM snapshot_cleanup_candidates')) {
        candidateDeleteCallCount += 1
        return candidateDeleteCallCount === 1 ? { rows: [{ id: 1 }, { id: 2 }] } : { rows: [] }
      }
      return { rowCount: 2 }
    })

    const result = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90, batchSize: 2, maxRowsPerTable: 2 })

    expect(result.truncated).toBe(false)
  })

  it('marks the result as truncated and skips remaining tables once the time deadline has passed', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 10 }
      if (sql.includes('DELETE FROM snapshot_cleanup_candidates')) return { rows: [] }
      return { rowCount: 0 }
    })

    const result = await cleanupOldSnapshots({
      keepCount: 5,
      olderThanDays: 90,
      batchSize: 2,
      maxRowsPerTable: 10,
      maxDurationMs: -1,
    })

    expect(result.truncated).toBe(true)
    expect(Object.values(result.counts).every((n) => n === 0)).toBe(true)
  })

  it('marks the result as truncated when the base-table DELETE hits the statement_timeout', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 10 }
      if (sql.includes('DELETE FROM snapshot_cleanup_candidates')) return { rows: [{ id: 1 }, { id: 2 }] }
      throw new Error('canceling statement due to statement timeout')
    })

    const result = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90, batchSize: 2, maxRowsPerTable: 10 })

    expect(result.truncated).toBe(true)
    expect(mockClientRelease).toHaveBeenCalled()
  })

  it('marks the result as truncated when materializing candidates hits the statement_timeout', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) throw new Error('canceling statement due to statement timeout')
      return { rowCount: 0 }
    })

    const result = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90, batchSize: 2, maxRowsPerTable: 10 })

    expect(result.truncated).toBe(true)
    const totalDeleted = Object.values(result.counts).reduce((sum, n) => sum + n, 0)
    expect(totalDeleted).toBe(0)
  })

  it('does not falsely report a complete run when concurrent deletes shrink the actual delete count', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 5 }
      if (sql.includes('DELETE FROM snapshot_cleanup_candidates')) return { rows: [{ id: 1 }, { id: 2 }] }
      return { rowCount: 0 }
    })

    const result = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90, batchSize: 2, maxRowsPerTable: 5 })

    const totalDeleted = Object.values(result.counts).reduce((sum, n) => sum + n, 0)
    expect(totalDeleted).toBe(0)
  })

  it('rotates the starting table between invocations so no table is starved by a slow table ahead of it', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 0 }
      return { rows: [] }
    })

    const firstRun = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90 })
    const secondRun = await cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90 })

    expect(Object.keys(firstRun.counts)[0]).not.toBe(Object.keys(secondRun.counts)[0])
  })

  it('serializes concurrent invocations instead of running them in parallel', async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET ') || sql.startsWith('DROP TABLE')) return {}
      if (sql.includes('CREATE TEMP TABLE')) return { rowCount: 0 }
      return { rows: [] }
    })

    const [firstRun, secondRun] = await Promise.all([
      cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90 }),
      cleanupOldSnapshots({ keepCount: 5, olderThanDays: 90 }),
    ])

    expect(firstRun).toBe(secondRun)
    expect(mockPoolConnect).toHaveBeenCalledTimes(9)
  })
})
