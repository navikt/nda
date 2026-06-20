import { logger } from '~/lib/logger.server'
import { pool } from './connection.server'

export {
  SYNC_JOB_STATUS_LABELS,
  SYNC_JOB_TYPE_LABELS,
  type SyncJobStatus,
  type SyncJobType,
} from './sync-job-types'

import type { SyncJob, SyncJobLog, SyncJobStatus, SyncJobType, SyncJobWithApp } from './sync-job-types'

export const SYNC_INTERVAL_MS = 5 * 60 * 1000

const POD_ID = process.env.HOSTNAME || `local-${process.pid}`
const APP_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'unknown'

export async function releaseExpiredLocks(): Promise<number> {
  const result = await pool.query(
    `UPDATE sync_jobs 
     SET status = 'failed', 
         error = 'Lock timeout - automatically released',
         completed_at = NOW()
     WHERE status = 'running' AND lock_expires_at < NOW()
     RETURNING id`,
  )
  return result.rowCount || 0
}

export async function acquireSyncLock(
  jobType: SyncJobType,
  appId: number,
  timeoutMinutes: number = 10,
  options?: Record<string, unknown>,
): Promise<number | null> {
  const cooldown = await pool.query(
    `SELECT 1 FROM sync_jobs
     WHERE job_type = $1 AND monitored_app_id = $2
       AND started_at > NOW() - INTERVAL '1 millisecond' * $3
     LIMIT 1`,
    [jobType, appId, SYNC_INTERVAL_MS],
  )
  if (cooldown.rowCount && cooldown.rowCount > 0) {
    return null
  }

  const released = await releaseExpiredLocks()
  if (released > 0) {
    logger.info(`🔓 Released ${released} expired lock(s)`)
  }

  try {
    const result = await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at, options)
       VALUES ($1, $2, 'running', NOW(), $3, NOW() + INTERVAL '1 minute' * $4, $5)
       RETURNING id`,
      [jobType, appId, POD_ID, timeoutMinutes, JSON.stringify({ ...options, version: APP_VERSION })],
    )
    logger.info(`🔒 Acquired ${jobType} lock for app ${appId} (job ${result.rows[0].id})`)
    return result.rows[0].id
  } catch (e: unknown) {
    if (e instanceof Error && 'code' in e && e.code === '23505') {
      logger.info(`⏳ ${jobType} lock for app ${appId} already held by another process`)
      return null
    }
    throw e
  }
}

export async function releaseSyncLock(
  jobId: number,
  status: 'completed' | 'failed',
  result?: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await pool.query(
    `UPDATE sync_jobs 
     SET status = $2, 
         completed_at = NOW(),
         result = $3,
         error = $4
     WHERE id = $1`,
    [jobId, status, result ? JSON.stringify(result) : null, error || null],
  )
  logger.info(`🔓 Released lock for job ${jobId} with status ${status}`)
}

export async function cleanupOldSyncJobs(keepPerApp: number = 50): Promise<number> {
  const result = await pool.query(
    `DELETE FROM sync_jobs 
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY monitored_app_id ORDER BY created_at DESC) as rn
         FROM sync_jobs
       ) ranked
       WHERE rn <= $1
     )
     RETURNING id`,
    [keepPerApp],
  )
  return result.rowCount || 0
}

export async function getAllSyncJobs(filters?: {
  status?: SyncJobStatus
  jobType?: SyncJobType
  appName?: string
  limit?: number
}): Promise<SyncJobWithApp[]> {
  const whereClauses: string[] = []
  const params: (string | number)[] = []
  let paramIndex = 1

  if (filters?.status) {
    whereClauses.push(`sj.status = $${paramIndex}`)
    params.push(filters.status)
    paramIndex++
  }

  if (filters?.jobType) {
    whereClauses.push(`sj.job_type = $${paramIndex}`)
    params.push(filters.jobType)
    paramIndex++
  }

  if (filters?.appName) {
    whereClauses.push(`ma.app_name = $${paramIndex}`)
    params.push(filters.appName)
    paramIndex++
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const limit = filters?.limit || 100

  const result = await pool.query(
    `SELECT 
       sj.*,
       ma.app_name,
       ma.team_slug,
       ma.environment_name
     FROM sync_jobs sj
     LEFT JOIN monitored_applications ma ON sj.monitored_app_id = ma.id
     ${whereClause}
     ORDER BY sj.created_at DESC
     LIMIT $${paramIndex}`,
    [...params, limit],
  )
  return result.rows
}

export async function getSyncJobAppNames(): Promise<string[]> {
  const result = await pool.query(`
    SELECT DISTINCT ma.app_name
    FROM sync_jobs sj
    JOIN monitored_applications ma ON sj.monitored_app_id = ma.id
    ORDER BY ma.app_name
  `)
  return result.rows.map((row: { app_name: string }) => row.app_name)
}

export async function getSyncJobStats(): Promise<{
  total: number
  running: number
  completed: number
  failed: number
  cancelled: number
  lastHour: number
}> {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour
    FROM sync_jobs
  `)
  return {
    total: parseInt(result.rows[0].total, 10),
    running: parseInt(result.rows[0].running, 10),
    completed: parseInt(result.rows[0].completed, 10),
    failed: parseInt(result.rows[0].failed, 10),
    cancelled: parseInt(result.rows[0].cancelled, 10),
    lastHour: parseInt(result.rows[0].last_hour, 10),
  }
}

export async function getSyncJobsForApp(
  appId: number,
  options?: { limit?: number; jobType?: SyncJobType },
): Promise<SyncJob[]> {
  const conditions = ['monitored_app_id = $1']
  const params: (string | number)[] = [appId]
  let paramIndex = 2

  if (options?.jobType) {
    conditions.push(`job_type = $${paramIndex}`)
    params.push(options.jobType)
    paramIndex++
  }

  const limit = options?.limit ?? 100
  params.push(limit)

  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, options, created_at
     FROM sync_jobs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${paramIndex}`,
    params,
  )
  return result.rows
}

export async function getLatestSyncJob(appId: number, jobType: SyncJobType): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, created_at
     FROM sync_jobs
     WHERE monitored_app_id = $1 AND job_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [appId, jobType],
  )
  return result.rows[0] || null
}

export async function getSyncJobById(jobId: number): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, created_at
     FROM sync_jobs
     WHERE id = $1`,
    [jobId],
  )
  return result.rows[0] || null
}

export async function updateSyncJobProgress(jobId: number, progress: Record<string, unknown> | object): Promise<void> {
  await pool.query(`UPDATE sync_jobs SET result = $2 WHERE id = $1 AND status = 'running'`, [
    jobId,
    JSON.stringify(progress),
  ])
}

export async function cancelSyncJob(jobId: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sync_jobs 
     SET status = 'cancelled', completed_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING id`,
    [jobId],
  )
  if (result.rowCount && result.rowCount > 0) {
    logger.info(`🛑 Cancelled sync job ${jobId}`)
    return true
  }
  return false
}

export async function isSyncJobCancelled(jobId: number): Promise<boolean> {
  const result = await pool.query(`SELECT status FROM sync_jobs WHERE id = $1`, [jobId])
  return result.rows[0]?.status === 'cancelled'
}

export async function heartbeatSyncJob(jobId: number, extendMinutes: number = 5): Promise<void> {
  await pool.query(
    `UPDATE sync_jobs 
     SET lock_expires_at = NOW() + INTERVAL '1 minute' * $2
     WHERE id = $1 AND status = 'running'`,
    [jobId, extendMinutes],
  )
}

export async function forceReleaseSyncJob(jobId: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE sync_jobs 
     SET status = 'failed', 
         completed_at = NOW(),
         error = 'Tvangsfrigjort av administrator'
     WHERE id = $1 AND status = 'running'
     RETURNING id`,
    [jobId],
  )
  if (result.rowCount && result.rowCount > 0) {
    logger.info(`🔓 Force-released sync job ${jobId}`)
    return true
  }
  return false
}

export async function logSyncJobMessage(
  jobId: number,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await pool.query(`INSERT INTO sync_job_logs (job_id, level, message, details) VALUES ($1, $2, $3, $4)`, [
    jobId,
    level,
    message,
    details ? JSON.stringify(details) : null,
  ])
}

export async function getSyncJobOptions(jobId: number): Promise<Record<string, unknown> | null> {
  const result = await pool.query(`SELECT options FROM sync_jobs WHERE id = $1`, [jobId])
  return result.rows[0]?.options || null
}

export async function getSyncJobLogs(
  jobId: number,
  options?: { afterId?: number; limit?: number },
): Promise<SyncJobLog[]> {
  const afterId = options?.afterId || 0
  const limit = options?.limit || 500

  const result = await pool.query(
    `SELECT id, job_id, level, message, details, created_at
     FROM sync_job_logs
     WHERE job_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [jobId, afterId, limit],
  )
  return result.rows
}

export async function cancelRunningJobsForPod(podId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE sync_jobs
     SET status = 'cancelled', completed_at = NOW(), error = 'Pod shutdown (SIGTERM)'
     WHERE status = 'running' AND locked_by = $1
     RETURNING id`,
    [podId],
  )
  const count = result.rowCount || 0

  for (const row of result.rows) {
    await logSyncJobMessage(row.id, 'warn', `Jobb avbrutt pga. pod shutdown (${podId})`)
  }

  return count
}
