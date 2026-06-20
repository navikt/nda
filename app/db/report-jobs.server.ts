import { pool } from '~/db/connection.server'
import { toDateString } from '~/lib/date-utils'
import type { ReportPeriodType } from '~/lib/report-periods'

const STALE_JOB_THRESHOLD_MS = 5 * 60 * 1000
const STALE_JOB_THRESHOLD_SQL = `${STALE_JOB_THRESHOLD_MS} milliseconds`

export async function createReportJob(
  monitoredAppId: number,
  year: number,
  periodType: ReportPeriodType,
  periodLabel: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ jobId: string; created: boolean; status: string; createdAt: Date; startedAt: Date | null }> {
  const result = await pool.query(
    `INSERT INTO report_jobs (monitored_app_id, year, period_type, period_label, period_start, period_end, status)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, 'pending')
     ON CONFLICT (monitored_app_id, period_type, period_start, period_end) WHERE status IN ('pending', 'processing')
     DO UPDATE SET status = report_jobs.status
     RETURNING job_id, (xmax = 0) AS created, status, created_at, started_at`,
    [monitoredAppId, year, periodType, periodLabel, toDateString(periodStart), toDateString(periodEnd)],
  )
  return {
    jobId: result.rows[0].job_id,
    created: result.rows[0].created,
    status: result.rows[0].status,
    createdAt: result.rows[0].created_at,
    startedAt: result.rows[0].started_at,
  }
}

export async function getReportJobStatus(
  jobId: string,
): Promise<{ status: string; error: string | null; created_at: Date; completed_at: Date | null } | null> {
  const result = await pool.query(
    `SELECT status, error, created_at, completed_at
     FROM report_jobs
     WHERE job_id = $1`,
    [jobId],
  )
  return result.rows[0] || null
}

export async function getReportJobWithPdf(
  jobId: string,
): Promise<{ status: string; pdf_data: Buffer | null; app_name: string; year: number } | null> {
  const result = await pool.query(
    `SELECT rj.pdf_data, rj.status, ma.app_name, rj.year
     FROM report_jobs rj
     JOIN monitored_applications ma ON rj.monitored_app_id = ma.id
     WHERE rj.job_id = $1`,
    [jobId],
  )
  return result.rows[0] || null
}

export async function claimReportJob(jobId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE report_jobs SET status = 'processing', started_at = NOW()
     WHERE job_id = $1
       AND (status = 'pending' OR (status = 'processing' AND (started_at IS NULL OR started_at < NOW() - INTERVAL '${STALE_JOB_THRESHOLD_SQL}')))
     RETURNING job_id`,
    [jobId],
  )
  return result.rowCount === 1
}

export async function updateReportJobStatus(
  jobId: string,
  status: 'completed' | 'failed',
  pdfData?: Uint8Array,
  error?: string,
): Promise<void> {
  if (status === 'completed' && pdfData) {
    await pool.query(
      `UPDATE report_jobs SET status = 'completed', pdf_data = $2, completed_at = NOW() WHERE job_id = $1`,
      [jobId, pdfData],
    )
  } else if (status === 'failed') {
    await pool.query(`UPDATE report_jobs SET status = 'failed', error = $2 WHERE job_id = $1`, [jobId, error])
  }
}

export async function setReportJobAuditReportId(jobId: string, auditReportId: number): Promise<void> {
  await pool.query(`UPDATE report_jobs SET audit_report_id = $2 WHERE job_id = $1`, [jobId, auditReportId])
}

interface InFlightJob {
  job_id: string
  status: string
  audit_report_id: number | null
  created_at: Date
  started_at: Date | null
}

export async function findInFlightJob(
  monitoredAppId: number,
  periodType: ReportPeriodType,
  periodStart: Date,
): Promise<InFlightJob | null> {
  const result = await pool.query<InFlightJob>(
    `SELECT rj.job_id, rj.status, rj.audit_report_id, rj.created_at, rj.started_at
     FROM report_jobs rj
     LEFT JOIN audit_reports ar ON rj.audit_report_id = ar.id
     WHERE rj.monitored_app_id = $1
       AND rj.period_type = $2
       AND rj.period_start = $3::date
       AND rj.status IN ('pending', 'processing', 'completed')
       AND (rj.status != 'completed' OR (ar.id IS NOT NULL AND ar.archived_at IS NULL AND ar.superseded_at IS NULL))
     ORDER BY rj.created_at DESC
     LIMIT 1`,
    [monitoredAppId, periodType, toDateString(periodStart)],
  )
  return result.rows[0] || null
}

export function isStaleJob(job: { status: string; created_at: Date; started_at?: Date | null }): boolean {
  if (job.status === 'pending') {
    return Date.now() - new Date(job.created_at).getTime() > STALE_JOB_THRESHOLD_MS
  }
  if (job.status === 'processing') {
    if (!job.started_at) return true
    return Date.now() - new Date(job.started_at).getTime() > STALE_JOB_THRESHOLD_MS
  }
  return false
}

interface AppScopedJobStatus {
  job_id: string
  status: string
  error: string | null
  created_at: Date
  completed_at: Date | null
  audit_report_id: number | null
}

export async function getReportJobStatusForApp(
  jobId: string,
  monitoredAppId: number,
): Promise<AppScopedJobStatus | null> {
  const result = await pool.query<AppScopedJobStatus>(
    `SELECT job_id, status, error, created_at, completed_at, audit_report_id
     FROM report_jobs
     WHERE job_id = $1 AND monitored_app_id = $2`,
    [jobId, monitoredAppId],
  )
  return result.rows[0] || null
}
