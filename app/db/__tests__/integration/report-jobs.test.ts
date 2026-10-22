import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AuditReportAssessmentModel } from '~/lib/audit-report-model'
import {
  claimReportJob,
  createReportJob,
  findInFlightJob,
  getReportJobStatus,
  getReportJobStatusForApp,
  ReportJobModelConflictError,
} from '../../report-jobs.server'
import { seedApp, truncateAllTables } from './helpers'

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

const periodStart = new Date('2025-01-01')
const periodEnd = new Date('2025-12-31')

function createJob(appId: number, assessmentModel?: AuditReportAssessmentModel) {
  return createReportJob(appId, 2025, 'yearly', '2025', periodStart, periodEnd, assessmentModel)
}

describe('report job assessment models', () => {
  it.each(['application', 'repository'] as const)('deduplicates concurrent %s jobs', async (assessmentModel) => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-fss' })
    const [first, second] = await Promise.all([createJob(appId, assessmentModel), createJob(appId, assessmentModel)])

    expect(first.jobId).toBe(second.jobId)
    expect([first, second].filter((job) => job.created)).toHaveLength(1)
    expect(await findInFlightJob(appId, 'yearly', periodStart, assessmentModel)).toMatchObject({
      job_id: first.jobId,
    })
  })

  it('keeps the previous application version able to create or reuse jobs during rollout', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-fss' })
    const createLegacyJob = () =>
      pool.query<{ job_id: string; assessment_model: string }>(
        `INSERT INTO report_jobs (monitored_app_id, year, period_type, period_label, period_start, period_end, status)
       VALUES ($1, 2025, 'yearly', '2025', $2::date, $3::date, 'pending')
       ON CONFLICT (monitored_app_id, period_type, period_start, period_end) WHERE status IN ('pending', 'processing')
       DO UPDATE SET status = report_jobs.status
       RETURNING job_id, assessment_model`,
        [appId, '2025-01-01', '2025-12-31'],
      )
    const [legacy, current] = await Promise.all([createLegacyJob(), createJob(appId)])
    const reused = await createLegacyJob()

    expect(legacy.rows[0].assessment_model).toBe('application')
    expect(current.jobId).toBe(legacy.rows[0].job_id)
    expect(reused.rows[0].job_id).toBe(current.jobId)
  })

  it.each(['application', 'repository'] as const)(
    'rejects reusing a concurrent %s job for a different assessment model',
    async (assessmentModel) => {
      const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-fss' })
      const otherModel = assessmentModel === 'application' ? 'repository' : 'application'
      const results = await Promise.allSettled([createJob(appId, assessmentModel), createJob(appId, otherModel)])
      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      const rejected = results.filter((result) => result.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toBeInstanceOf(ReportJobModelConflictError)
      const { rows } = await pool.query(
        'SELECT job_id, assessment_model FROM report_jobs WHERE monitored_app_id = $1',
        [appId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].job_id).toBe(fulfilled[0].value.jobId)
    },
  )

  it.each(['application', 'repository'] as const)(
    'expires stale jobs from the other model before creating a %s job',
    async (assessmentModel) => {
      const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'test', environment: 'prod-gcp' })
      const otherModel = assessmentModel === 'application' ? 'repository' : 'application'
      for (const status of ['pending', 'processing', 'processing_without_start'] as const) {
        const abandoned = await createJob(appId, otherModel)
        await pool.query(
          `UPDATE report_jobs SET status = $2, created_at = NOW() - INTERVAL '10 minutes',
             started_at = CASE WHEN $3::boolean THEN NULL ELSE NOW() - INTERVAL '10 minutes' END
           WHERE job_id = $1`,
          [abandoned.jobId, status === 'pending' ? 'pending' : 'processing', status === 'processing_without_start'],
        )
        const replacement = await createJob(appId, assessmentModel)
        expect(replacement.created).toBe(true)
        expect(replacement.jobId).not.toBe(abandoned.jobId)
        expect(await getReportJobStatus(abandoned.jobId, otherModel)).toMatchObject({
          status: 'failed',
          error: expect.stringContaining('expired'),
          completed_at: expect.any(Date),
        })
        await pool.query("UPDATE report_jobs SET status = 'completed' WHERE job_id = $1", [replacement.jobId])
      }
    },
  )

  it('keeps a recently started job active even when it was created long ago', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'test', environment: 'prod-gcp' })
    const existing = await createJob(appId, 'repository')
    await pool.query(
      `UPDATE report_jobs SET status = 'processing', created_at = NOW() - INTERVAL '10 minutes', started_at = NOW()
       WHERE job_id = $1`,
      [existing.jobId],
    )
    await expect(createJob(appId)).rejects.toBeInstanceOf(ReportJobModelConflictError)
    expect(await getReportJobStatus(existing.jobId, 'repository')).toMatchObject({ status: 'processing' })
  })

  it('keeps stale same-model jobs available for takeover and does not expire a different period', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-fjord', appName: 'test', environment: 'prod-gcp' })
    const existing = await createJob(appId, 'repository')
    await pool.query("UPDATE report_jobs SET created_at = NOW() - INTERVAL '10 minutes' WHERE job_id = $1", [
      existing.jobId,
    ])
    expect(await createJob(appId, 'repository')).toMatchObject({ jobId: existing.jobId, created: false })
    await createReportJob(appId, 2024, 'yearly', '2024', new Date('2024-01-01'), new Date('2024-12-31'))
    expect(await getReportJobStatus(existing.jobId, 'repository')).toMatchObject({ status: 'pending' })
  })

  it('requires an explicit repository model to find, poll or claim a repository job', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod-fss' })
    const job = await createJob(appId, 'repository')

    expect(await findInFlightJob(appId, 'yearly', periodStart)).toBeNull()
    expect(await getReportJobStatus(job.jobId)).toBeNull()
    expect(await getReportJobStatusForApp(job.jobId, appId)).toBeNull()
    expect(await claimReportJob(job.jobId)).toBe(false)
    expect(await getReportJobStatus(job.jobId, 'repository')).toMatchObject({ status: 'pending' })
    expect(await getReportJobStatusForApp(job.jobId, appId, 'repository')).toMatchObject({ status: 'pending' })
    expect(await claimReportJob(job.jobId, 'repository')).toBe(true)
    expect(await getReportJobStatus(job.jobId, 'repository')).toMatchObject({ status: 'processing' })
    expect(await claimReportJob(job.jobId, 'repository')).toBe(false)
  })
})
