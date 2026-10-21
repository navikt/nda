import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AuditReportAssessmentModel } from '~/lib/audit-report-model'
import {
  claimReportJob,
  createReportJob,
  findInFlightJob,
  getReportJobStatus,
  getReportJobStatusForApp,
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
      expect(rejected[0].reason).toEqual(
        new Error('An in-flight report job already exists for this period with a different assessment model.'),
      )
      const { rows } = await pool.query(
        'SELECT job_id, assessment_model FROM report_jobs WHERE monitored_app_id = $1',
        [appId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].job_id).toBe(fulfilled[0].value.jobId)
    },
  )

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
