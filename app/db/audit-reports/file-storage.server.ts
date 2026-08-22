import { pool } from '../connection.server'

export async function saveAuditReportFile(reportId: number, format: 'pdf' | 'xlsx', data: Buffer): Promise<void> {
  await pool.query(
    `INSERT INTO audit_report_files (audit_report_id, format, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (audit_report_id, format) DO UPDATE SET data = EXCLUDED.data`,
    [reportId, format, data],
  )
}

export async function getAuditReportFile(reportId: number, format: 'pdf' | 'xlsx'): Promise<Buffer | null> {
  const result = await pool.query<{ data: Buffer }>(
    'SELECT data FROM audit_report_files WHERE audit_report_id = $1 AND format = $2',
    [reportId, format],
  )
  return result.rows[0]?.data ?? null
}
