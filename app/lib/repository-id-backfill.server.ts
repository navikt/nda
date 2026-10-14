import { pool } from '~/db/connection.server'
import {
  getSyncJobById,
  heartbeatRepositoryIdBackfillJob,
  isSyncJobCancelled,
  releaseSyncLock,
} from '~/db/sync-jobs.server'
import { backfillEligibleWorkflowRunRepositoryIds } from '~/db/workflow-run-repository-backfill-coverage.server'
import { logger, runWithJobContext } from '~/lib/logger.server'

const BACKFILL_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000
const BACKFILL_HEARTBEAT_EXTENSION_MINUTES = 30

export async function queueRepositoryIdBackfill(
  repositoryId: number,
  initiatedBy: string,
): Promise<{ jobId: number; started: boolean } | null> {
  const expiredJobs = await pool.query(
    `UPDATE sync_jobs
     SET status = 'failed',
         completed_at = NOW(),
         error = 'Lock timeout - automatically released'
     WHERE job_type = 'backfill_github_repo_ids'
       AND repository_id = $1
       AND status = 'running'
       AND lock_expires_at < NOW()
     RETURNING id`,
    [repositoryId],
  )
  if ((expiredJobs.rowCount ?? 0) > 0) {
    logger.warn(`Released expired repository-ID backfill lock for repository ${repositoryId}`)
  }

  const result = await pool.query<{ id: number }>(
    `INSERT INTO sync_jobs
       (job_type, repository_id, status, started_at, locked_by, lock_expires_at, result, options)
     VALUES ('backfill_github_repo_ids', $1, 'running', NOW(), $2, NOW() + INTERVAL '30 minutes', $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      repositoryId,
      process.env.HOSTNAME || `local-${process.pid}`,
      JSON.stringify({ updated: 0 }),
      JSON.stringify({ initiatedBy }),
    ],
  )
  const createdJob = result.rows[0]
  if (createdJob) return { jobId: createdJob.id, started: true }

  const activeJob = await pool.query<{ id: number }>(
    `SELECT id
     FROM sync_jobs
     WHERE job_type = 'backfill_github_repo_ids'
       AND repository_id = $1
       AND status = 'running'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [repositoryId],
  )
  const existingJob = activeJob.rows[0]
  return existingJob ? { jobId: existingJob.id, started: false } : null
}

export async function processRepositoryIdBackfillJobAsync(jobId: number, repositoryId: number): Promise<void> {
  await runWithJobContext(jobId, 'backfill_github_repo_ids', { repositoryId }, false, async () => {
    let heartbeatInProgress: Promise<void> | undefined
    let heartbeatError: unknown
    let leaseLost = false
    const heartbeat = setInterval(() => {
      if (heartbeatInProgress) return
      heartbeatInProgress = heartbeatRepositoryIdBackfillJob(jobId, BACKFILL_HEARTBEAT_EXTENSION_MINUTES)
        .then((leaseExtended) => {
          if (!leaseExtended) {
            leaseLost = true
            logger.warn(`Repository-ID backfill lease is no longer current for job ${jobId}`)
            clearInterval(heartbeat)
          } else {
            heartbeatError = undefined
          }
        })
        .catch((error: unknown) => {
          heartbeatError = error
          logger.error(`Failed to extend repository-ID backfill lease for job ${jobId}`, error)
        })
        .finally(() => {
          heartbeatInProgress = undefined
        })
    }, BACKFILL_HEARTBEAT_INTERVAL_MS)

    try {
      if (await isSyncJobCancelled(jobId)) return

      const updated = await backfillEligibleWorkflowRunRepositoryIds(repositoryId)
      await heartbeatInProgress
      if (leaseLost) throw new Error(`Repository-ID backfill lease was lost for job ${jobId}`)
      if (heartbeatError) throw heartbeatError

      const job = await getSyncJobById(jobId)
      if (job?.status !== 'running') return

      await releaseSyncLock(jobId, 'completed', { updated, repositoryId })
      logger.info(`Repository-ID backfill updated ${updated} deployment(s) for repository ${repositoryId}`)
    } catch (error) {
      const job = await getSyncJobById(jobId)
      if (job?.status === 'running') {
        const message = error instanceof Error ? error.message : String(error)
        await releaseSyncLock(jobId, 'failed', undefined, message)
      }
      throw error
    } finally {
      clearInterval(heartbeat)
      await heartbeatInProgress
    }
  })
}

export function startRepositoryIdBackfillJob(jobId: number, repositoryId: number): void {
  processRepositoryIdBackfillJobAsync(jobId, repositoryId).catch((error: unknown) => {
    logger.error(
      `Repository-ID backfill job ${jobId} failed`,
      error instanceof Error ? error : new Error(String(error)),
    )
  })
}
