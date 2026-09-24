import { BACKFILL_GITHUB_REPO_ID_LOCK_KEY, pool } from '~/db/connection.server'
import { logger } from '~/lib/logger.server'
import { resolveGithubRepoIdFromWorkflowRunDetailed } from './git.server'

export interface BackfillDeploymentGithubRepoIdOptions {
  maxRows?: number
  timeBudgetMs?: number
}

export interface BackfillDeploymentGithubRepoIdResult {
  processed: number
  resolved: number
  unresolved: number
  transientFailures: number
  remaining: number
  truncated: boolean
  alreadyRunning: boolean
}

const DEFAULT_MAX_ROWS = 100_000
const DEFAULT_TIME_BUDGET_MS = 20_000

const BACKFILL_CANDIDATE_WHERE = `
  github_repo_id IS NULL
  AND github_repo_id_backfill_attempted_at IS NULL
  AND trigger_url IS NOT NULL
  AND detected_github_owner IS NOT NULL
  AND detected_github_repo_name IS NOT NULL
`

// See the migration comment on the github_repo_id column for why resolving via the workflow
// run (trigger_url) is safe here, unlike a naive owner/name backfill.
export async function backfillDeploymentGithubRepoIds(
  options: BackfillDeploymentGithubRepoIdOptions = {},
): Promise<BackfillDeploymentGithubRepoIdResult> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = Date.now()

  const lockClient = await pool.connect()
  let lockClientDestroyed = false
  try {
    const { rows: lockRows } = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [BACKFILL_GITHUB_REPO_ID_LOCK_KEY],
    )
    if (!lockRows[0].locked) {
      logger.warn('Deployment github_repo_id backfill is already running — skipping this invocation')
      const remaining = await countDeploymentsPendingGithubRepoIdBackfill()
      return {
        processed: 0,
        resolved: 0,
        unresolved: 0,
        transientFailures: 0,
        remaining,
        truncated: true,
        alreadyRunning: true,
      }
    }

    const { rows } = await pool.query<{
      id: number
      trigger_url: string
      detected_github_owner: string
      detected_github_repo_name: string
    }>(
      `
      SELECT id, trigger_url, detected_github_owner, detected_github_repo_name
      FROM deployments
      WHERE ${BACKFILL_CANDIDATE_WHERE}
      ORDER BY id
      LIMIT $1
    `,
      [maxRows],
    )

    let resolved = 0
    let unresolved = 0
    let transientFailures = 0
    let truncated = false

    for (const row of rows) {
      if (Date.now() - startedAt > timeBudgetMs) {
        truncated = true
        break
      }

      const { repositoryId, permanentFailure } = await resolveGithubRepoIdFromWorkflowRunDetailed(
        row.detected_github_owner,
        row.detected_github_repo_name,
        row.trigger_url,
      )

      if (repositoryId === null) {
        if (permanentFailure) {
          await pool.query(
            `UPDATE deployments SET github_repo_id_backfill_attempted_at = now() WHERE id = $1 AND github_repo_id IS NULL`,
            [row.id],
          )
          unresolved++
        } else {
          // Transient failure (network error, rate limit, 5xx) — leave the row eligible so a
          // later run can retry it, rather than permanently giving up on it.
          transientFailures++
        }
        continue
      }

      await pool.query(
        `UPDATE deployments SET github_repo_id = $1, github_repo_id_backfill_attempted_at = NULL WHERE id = $2 AND github_repo_id IS NULL`,
        [repositoryId, row.id],
      )
      resolved++
    }

    const processed = resolved + unresolved + transientFailures
    if (processed < rows.length) {
      truncated = true
    }

    const { rows: remainingRows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM deployments WHERE ${BACKFILL_CANDIDATE_WHERE}`,
    )
    const remaining = parseInt(remainingRows[0]?.count ?? '0', 10)

    if (!truncated && rows.length === maxRows && remaining > 0) {
      truncated = true
    }

    logger.info(
      `Deployment github_repo_id backfill batch complete: ${resolved} resolved, ${unresolved} unresolved, ${transientFailures} transient failures, ${remaining} remaining`,
    )

    return { processed, resolved, unresolved, transientFailures, remaining, truncated, alreadyRunning: false }
  } finally {
    try {
      await lockClient.query(`SELECT pg_advisory_unlock($1)`, [BACKFILL_GITHUB_REPO_ID_LOCK_KEY])
    } catch (unlockError) {
      logger.error('Failed to release backfill advisory lock, destroying connection', unlockError)
      lockClientDestroyed = true
      lockClient.release(true)
    } finally {
      if (!lockClientDestroyed) {
        lockClient.release()
      }
    }
  }
}

export async function countDeploymentsPendingGithubRepoIdBackfill(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM deployments WHERE ${BACKFILL_CANDIDATE_WHERE}`,
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}
