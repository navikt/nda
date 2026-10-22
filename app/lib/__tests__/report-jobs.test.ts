import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.hoisted(() => vi.fn())
vi.mock('~/db/connection.server', () => ({ pool: { query } }))

import { createReportJob, ReportJobModelConflictError } from '~/db/report-jobs.server'

beforeEach(() => vi.resetAllMocks())

describe('report job creation', () => {
  it('expires stale cross-model jobs before using the existing conflict key', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({
      rows: [{ job_id: 'new-job', created: true, status: 'pending', created_at: new Date(), started_at: null }],
    })
    const result = await createReportJob(1, 2025, 'yearly', '2025', new Date('2025-01-01'), new Date('2025-12-31'))
    expect(result).toMatchObject({ jobId: 'new-job', created: true })
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining("SET status = 'failed'"),
      [1, 'yearly', '2025-01-01', '2025-12-31', 'application'],
    ])
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT (monitored_app_id, period_type, period_start, period_end)')
  })

  it('still reports a fresh cross-model conflict explicitly', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [] })
    await expect(
      createReportJob(1, 2025, 'yearly', '2025', new Date('2025-01-01'), new Date('2025-12-31'), 'repository'),
    ).rejects.toBeInstanceOf(ReportJobModelConflictError)
  })

  it('does not create a job if expiration fails', async () => {
    const error = new Error('database unavailable')
    query.mockRejectedValueOnce(error)
    await expect(
      createReportJob(1, 2025, 'yearly', '2025', new Date('2025-01-01'), new Date('2025-12-31')),
    ).rejects.toBe(error)
    expect(query).toHaveBeenCalledTimes(1)
  })
})
