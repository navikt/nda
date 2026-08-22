import { pool } from '../connection.server'

export async function archiveAuditReport(
  id: number,
  monitoredAppId: number,
  archivedBy: string,
  reason: string,
): Promise<boolean> {
  const result = await pool.query(
    'UPDATE audit_reports SET archived_at = NOW(), archived_by = $1, archive_reason = $2 WHERE id = $3 AND monitored_app_id = $4 AND archived_at IS NULL',
    [archivedBy, reason, id, monitoredAppId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function restoreAuditReport(id: number, monitoredAppId: number, restoredBy: string): Promise<boolean> {
  const result = await pool.query(
    'UPDATE audit_reports SET archived_at = NULL, restored_at = NOW(), restored_by = $1 WHERE id = $2 AND monitored_app_id = $3 AND archived_at IS NOT NULL',
    [restoredBy, id, monitoredAppId],
  )
  return (result.rowCount ?? 0) > 0
}
