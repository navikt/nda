import { pool } from '~/db/connection.server'
import type { ReportPeriodType } from '~/lib/report-periods'

export async function createReportJob(
  monitoredAppId: number,
  year: number,
  periodType: ReportPeriodType,
  periodLabel: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO report_jobs (monitored_app_id, year, period_type, period_label, period_start, period_end, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING job_id`,
    [monitoredAppId, year, periodType, periodLabel, periodStart, periodEnd],
  )
  return result.rows[0].job_id
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

export async function updateReportJobStatus(
  jobId: string,
  status: 'processing' | 'completed' | 'failed',
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
  } else {
    await pool.query(`UPDATE report_jobs SET status = $2 WHERE job_id = $1`, [jobId, status])
  }
}
