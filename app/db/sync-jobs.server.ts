import type { PoolClient } from 'pg'
import { logger } from '~/lib/logger.server'
import { lockRepositoryAdminForWrite, pool, withTransaction } from './connection.server'

export {
  SYNC_JOB_STATUS_LABELS,
  SYNC_JOB_TYPE_LABELS,
  type SyncJobStatus,
  type SyncJobType,
} from './sync-job-types'

import type { SyncJob, SyncJobLog, SyncJobStatus, SyncJobType, SyncJobWithApp } from './sync-job-types'

export const SYNC_INTERVAL_MS = 5 * 60 * 1000

const REPOSITORY_LINKED_JOB_TYPES: ReadonlySet<SyncJobType> = new Set(['fetch_verification_data'])

const POD_ID = process.env.HOSTNAME || `local-${process.pid}`
const APP_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'unknown'

export async function releaseExpiredLocks(executor: { query: typeof pool.query } = pool): Promise<number> {
  const result = await executor.query(
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
): Promise<number | null | 'repository_conflict'> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const needsCrossScopeCoordination = REPOSITORY_LINKED_JOB_TYPES.has(jobType)
    if (needsCrossScopeCoordination) {
      await lockRepositoryAdminForWrite(client)
    }

    const released = await releaseExpiredLocks(client)
    if (released > 0) {
      logger.info(`🔓 Released ${released} expired lock(s)`)
    }

    const cooldown = await client.query(
      `SELECT 1 FROM sync_jobs
       WHERE job_type = $1 AND monitored_app_id = $2
         AND started_at > NOW() - INTERVAL '1 millisecond' * $3
       LIMIT 1`,
      [jobType, appId, SYNC_INTERVAL_MS],
    )
    if (cooldown.rowCount && cooldown.rowCount > 0) {
      await client.query('COMMIT')
      return null
    }

    if (needsCrossScopeCoordination) {
      const linkedRepos = await client.query<{ id: number }>(
        `SELECT r.id FROM application_repositories ar
         JOIN repositories r ON r.github_repo_id = ar.github_repo_id
         WHERE ar.monitored_app_id = $1 AND ar.status IN ('active', 'historical')`,
        [appId],
      )
      const repoIds = linkedRepos.rows.map((row) => row.id)
      if (repoIds.length > 0) {
        const conflictingRepoJob = await client.query(
          `SELECT 1 FROM sync_jobs
           WHERE job_type = $1 AND status = 'running' AND repository_id = ANY($2::int[])
           LIMIT 1`,
          [jobType, repoIds],
        )
        if (conflictingRepoJob.rowCount && conflictingRepoJob.rowCount > 0) {
          logger.info(`⏳ ${jobType} lock for app ${appId} blocked by a running repository-scoped job`)
          await client.query('COMMIT')
          return 'repository_conflict'
        }
      }
    }

    const result = await client.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at, options)
       VALUES ($1, $2, 'running', NOW(), $3, NOW() + INTERVAL '1 minute' * $4, $5)
       RETURNING id`,
      [jobType, appId, POD_ID, timeoutMinutes, JSON.stringify({ ...options, version: APP_VERSION })],
    )
    await client.query('COMMIT')
    logger.info(`🔒 Acquired ${jobType} lock for app ${appId} (job ${result.rows[0].id})`)
    return result.rows[0].id
  } catch (e: unknown) {
    await client.query('ROLLBACK')
    if (e instanceof Error && 'code' in e && e.code === '23505') {
      logger.info(`⏳ ${jobType} lock for app ${appId} already held by another process`)
      return null
    }
    throw e
  } finally {
    client.release()
  }
}

export async function acquireSyncLockForRepository(
  jobType: SyncJobType,
  repositoryId: number,
  timeoutMinutes: number = 10,
  options?: Record<string, unknown>,
  verifyAccess?: (client: PoolClient) => Promise<boolean>,
): Promise<number | null | 'unauthorized' | 'app_conflict'> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const needsCrossScopeCoordination = REPOSITORY_LINKED_JOB_TYPES.has(jobType)
    if (needsCrossScopeCoordination) {
      await lockRepositoryAdminForWrite(client)
    }

    if (verifyAccess && !(await verifyAccess(client))) {
      await client.query('COMMIT')
      return 'unauthorized'
    }

    const released = await releaseExpiredLocks(client)
    if (released > 0) {
      logger.info(`🔓 Released ${released} expired lock(s)`)
    }

    const cooldown = await client.query(
      `SELECT 1 FROM sync_jobs
       WHERE job_type = $1 AND repository_id = $2
         AND started_at > NOW() - INTERVAL '1 millisecond' * $3
       LIMIT 1`,
      [jobType, repositoryId, SYNC_INTERVAL_MS],
    )
    if (cooldown.rowCount && cooldown.rowCount > 0) {
      await client.query('COMMIT')
      return null
    }

    if (needsCrossScopeCoordination) {
      const conflictingAppJob = await client.query(
        `SELECT 1 FROM sync_jobs sj
         WHERE sj.job_type = $1 AND sj.status = 'running'
           AND sj.monitored_app_id IN (
             SELECT ar.monitored_app_id FROM application_repositories ar
             JOIN repositories r ON r.github_repo_id = ar.github_repo_id
             WHERE ar.status IN ('active', 'historical') AND r.id = $2
           )
         LIMIT 1`,
        [jobType, repositoryId],
      )
      if (conflictingAppJob.rowCount && conflictingAppJob.rowCount > 0) {
        logger.info(`⏳ ${jobType} lock for repository ${repositoryId} blocked by a running app-scoped job`)
        await client.query('COMMIT')
        return 'app_conflict'
      }
    }

    const result = await client.query(
      `INSERT INTO sync_jobs (job_type, repository_id, status, started_at, locked_by, lock_expires_at, options)
       VALUES ($1, $2, 'running', NOW(), $3, NOW() + INTERVAL '1 minute' * $4, $5)
       RETURNING id`,
      [jobType, repositoryId, POD_ID, timeoutMinutes, JSON.stringify({ ...options, version: APP_VERSION })],
    )
    await client.query('COMMIT')
    logger.info(`🔒 Acquired ${jobType} lock for repository ${repositoryId} (job ${result.rows[0].id})`)
    return result.rows[0].id
  } catch (e: unknown) {
    await client.query('ROLLBACK')
    if (e instanceof Error && 'code' in e && e.code === '23505') {
      logger.info(`⏳ ${jobType} lock for repository ${repositoryId} already held by another process`)
      return null
    }
    throw e
  } finally {
    client.release()
  }
}

export async function releaseSyncLock(
  jobId: number,
  status: 'completed' | 'partial' | 'failed',
  result?: Record<string, unknown>,
  error?: string,
): Promise<boolean> {
  const updateResult = await pool.query(
    `UPDATE sync_jobs 
     SET status = $2, 
         completed_at = NOW(),
         result = $3,
         error = $4
     WHERE id = $1 AND status = 'running'`,
    [jobId, status, result ? JSON.stringify(result) : null, error || null],
  )
  const released = (updateResult.rowCount || 0) > 0
  if (released) {
    logger.info(`🔓 Released lock for job ${jobId} with status ${status}`)
  } else {
    logger.info(`🔒 Skipped releasing lock for job ${jobId} — job is no longer running (already in a terminal state)`)
  }
  return released
}

export async function isAppBlockedByRunningFetchJob(appId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM sync_jobs sj
     WHERE sj.job_type = 'fetch_verification_data' AND sj.status = 'running' AND sj.lock_expires_at > NOW()
       AND (
         sj.monitored_app_id = $1
         OR sj.repository_id IN (
           SELECT r.id FROM application_repositories ar
           JOIN repositories r ON r.github_repo_id = ar.github_repo_id
           WHERE ar.monitored_app_id = $1 AND ar.status IN ('active', 'historical')
         )
       )
     LIMIT 1`,
    [appId],
  )
  return (result.rowCount || 0) > 0
}

export async function cleanupOldSyncJobs(keepPerApp: number = 50): Promise<number> {
  const result = await pool.query(
    `DELETE FROM sync_jobs 
     WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY monitored_app_id, repository_id ORDER BY created_at DESC) as rn
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
  repositoryId?: number
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

  if (filters?.repositoryId) {
    whereClauses.push(`sj.repository_id = $${paramIndex}`)
    params.push(filters.repositoryId)
    paramIndex++
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const limit = filters?.limit || 100

  const result = await pool.query(
    `SELECT 
       sj.*,
       ma.app_name,
       ma.team_slug,
       ma.environment_name,
       r.github_owner,
       r.github_repo_name
     FROM sync_jobs sj
     LEFT JOIN monitored_applications ma ON sj.monitored_app_id = ma.id
     LEFT JOIN repositories r ON sj.repository_id = r.id
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
  partial: number
  failed: number
  cancelled: number
  lastHour: number
}> {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'partial' THEN 1 END) as partial,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour
    FROM sync_jobs
  `)
  return {
    total: parseInt(result.rows[0].total, 10),
    running: parseInt(result.rows[0].running, 10),
    completed: parseInt(result.rows[0].completed, 10),
    partial: parseInt(result.rows[0].partial, 10),
    failed: parseInt(result.rows[0].failed, 10),
    cancelled: parseInt(result.rows[0].cancelled, 10),
    lastHour: parseInt(result.rows[0].last_hour, 10),
  }
}

export interface FailedSyncJobGroup {
  monitored_app_id: number | null
  app_name: string | null
  team_slug: string | null
  environment_name: string | null
  repository_id: number | null
  github_owner: string | null
  github_repo_name: string | null
  job_type: SyncJobType
  error: string | null
  failure_count: number
  first_failed_at: string
  last_failed_at: string
}

export async function getFailedSyncJobsGrouped(jobType?: SyncJobType): Promise<FailedSyncJobGroup[]> {
  const params: string[] = []
  let jobTypeClause = ''
  if (jobType) {
    params.push(jobType)
    jobTypeClause = `AND sj.job_type = $${params.length}`
  }

  const result = await pool.query(
    `SELECT
       sj.monitored_app_id,
       ma.app_name,
       ma.team_slug,
       ma.environment_name,
       sj.repository_id,
       r.github_owner,
       r.github_repo_name,
       sj.job_type,
       sj.error,
       COUNT(*)::integer as failure_count,
       MIN(COALESCE(sj.completed_at, sj.created_at)) as first_failed_at,
       MAX(COALESCE(sj.completed_at, sj.created_at)) as last_failed_at
     FROM sync_jobs sj
     LEFT JOIN monitored_applications ma ON sj.monitored_app_id = ma.id
     LEFT JOIN repositories r ON sj.repository_id = r.id
     WHERE sj.status = 'failed' ${jobTypeClause}
     GROUP BY sj.monitored_app_id, ma.app_name, ma.team_slug, ma.environment_name,
              sj.repository_id, r.github_owner, r.github_repo_name, sj.job_type, sj.error
     ORDER BY last_failed_at DESC
     LIMIT 100`,
    params,
  )
  return result.rows
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
    `SELECT id, job_type, monitored_app_id, repository_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, options, created_at
     FROM sync_jobs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${paramIndex}`,
    params,
  )
  return result.rows
}

export async function getObservedSyncIntervalMs(
  appId: number,
  jobType: SyncJobType,
  sampleSize = 5,
): Promise<number | null> {
  const result = await pool.query<{ started_at: Date }>(
    `SELECT started_at
     FROM sync_jobs
     WHERE monitored_app_id = $1 AND job_type = $2 AND status = 'completed'
     ORDER BY started_at DESC
     LIMIT $3`,
    [appId, jobType, sampleSize],
  )

  if (result.rows.length < 2) {
    return null
  }

  const timestamps = result.rows.map((r) => new Date(r.started_at).getTime())
  const gaps: number[] = []
  for (let i = 0; i < timestamps.length - 1; i++) {
    gaps.push(timestamps[i] - timestamps[i + 1])
  }

  const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length
  return avgGap > 0 ? avgGap : null
}

export async function getLatestSyncJob(appId: number, jobType: SyncJobType): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, repository_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, created_at
     FROM sync_jobs
     WHERE monitored_app_id = $1 AND job_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [appId, jobType],
  )
  return result.rows[0] || null
}

export async function getLatestSyncJobForRepository(
  repositoryId: number,
  jobType: SyncJobType,
): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, repository_id, status, started_at, completed_at,
            locked_by, lock_expires_at, result, error, created_at
     FROM sync_jobs
     WHERE repository_id = $1 AND job_type = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [repositoryId, jobType],
  )
  return result.rows[0] || null
}

export async function getSyncJobById(jobId: number): Promise<SyncJob | null> {
  const result = await pool.query(
    `SELECT id, job_type, monitored_app_id, repository_id, status, started_at, completed_at,
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

export async function cancelSyncJob(
  jobId: number,
  verifyAccess?: (client: PoolClient) => Promise<boolean>,
): Promise<boolean | 'unauthorized'> {
  if (verifyAccess) {
    return withTransaction(async (client) => {
      await lockRepositoryAdminForWrite(client)
      if (!(await verifyAccess(client))) {
        return 'unauthorized'
      }
      const result = await client.query(
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
    })
  }

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

export async function forceReleaseSyncJob(
  jobId: number,
  verifyAccess?: (client: PoolClient) => Promise<boolean>,
): Promise<boolean | 'unauthorized'> {
  if (verifyAccess) {
    return withTransaction(async (client) => {
      await lockRepositoryAdminForWrite(client)
      if (!(await verifyAccess(client))) {
        return 'unauthorized'
      }
      const result = await client.query(
        `UPDATE sync_jobs 
         SET status = 'failed', 
             completed_at = NOW(),
             error = 'Tvangsfrigjort av administrator'
         WHERE id = $1 AND status = 'running' AND lock_expires_at < NOW()
         RETURNING id`,
        [jobId],
      )
      if (result.rowCount && result.rowCount > 0) {
        logger.info(`🔓 Force-released sync job ${jobId}`)
        return true
      }
      return false
    })
  }

  const result = await pool.query(
    `UPDATE sync_jobs 
     SET status = 'failed', 
         completed_at = NOW(),
         error = 'Tvangsfrigjort av administrator'
     WHERE id = $1 AND status = 'running' AND lock_expires_at < NOW()
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
