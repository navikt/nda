import type { PoolClient } from 'pg'
import { ROOT_APPROVED_STATUSES_SQL } from '~/lib/four-eyes-status'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import { pool } from './connection.server'
import { repositoryDeploymentSql } from './repository-deployment-sql'

const SIBLING_WAITER_LIMIT = 5
const SIBLING_CANDIDATE_LIMIT = 5
const SIBLING_MIN_RETRY_MS = 15 * 60 * 1000

export interface SiblingWork {
  id: number
  monitored_app_id: number
  commit_sha: string
  repository_id: number | null
  verification_repository_id: number | null
  created_at: string
  four_eyes_status: string
  environment_name: string
  detected_github_owner: string
  detected_github_repo_name: string
  default_branch: string
  trigger_url: string | null
  sibling_wait_candidate_id: number | null
  sibling_wait_basis: unknown
  sibling_wait_checked_at: string | null
  sibling_next_attempt_at: string | null
  sibling_refresh_after: string | null
  sibling_retry_count: number
  decision_signature: string | null
}

export interface SiblingBasis {
  version: 1
  repositoryId: number | null
  commitSha: string
  baseBranch: string
  configuredBaseBranch: string
  auditStartYear: number | null
  implicitApprovalMode: string
  repositoryStatus: string
  candidateId: number | null
  candidateStatus: string | null
  decision: string
}

const REPOSITORY_JOIN = `LEFT JOIN LATERAL (
  SELECT target_repository.id, target_repository.audit_start_year,
         target_repository.implicit_approval_mode, target_repository.default_branch
  FROM repositories target_repository WHERE ${repositoryDeploymentSql('target_repository.id')}
  ORDER BY target_repository.id LIMIT 1
) verification_repo ON true`

const WORK_SELECT = `SELECT d.*,
  d.created_at::text AS created_at,
  d.sibling_wait_checked_at::text AS sibling_wait_checked_at,
  d.sibling_next_attempt_at::text AS sibling_next_attempt_at,
  d.sibling_refresh_after::text AS sibling_refresh_after,
  verification_repo.id AS verification_repository_id,
  COALESCE(verification_repo.default_branch, ma.default_branch) AS default_branch,
  d.sibling_wait_basis->>'decision' AS decision_signature
  FROM deployments d
  JOIN monitored_applications ma ON ma.id = d.monitored_app_id
  ${REPOSITORY_JOIN}`

const BLOCKING_WAITER_SQL = `EXISTS (
  SELECT 1 FROM deployments waiter JOIN monitored_applications app ON app.id = waiter.monitored_app_id
  WHERE app.is_active = true AND waiter.four_eyes_status = 'pending_sibling_resolution'
    AND waiter.sibling_wait_candidate_id = d.id AND waiter.monitored_app_id != d.monitored_app_id
    AND waiter.commit_sha = d.commit_sha
    AND (waiter.created_at, waiter.id) > (d.created_at, d.id)
    AND EXISTS (
      SELECT 1 FROM deployments d WHERE d.id = waiter.id AND ${repositoryDeploymentSql('verification_repo.id')}
    )
)`

const WAITER_READY_SQL = `ma.is_active = true
  AND verification_repo.id IS NOT NULL AND ${VALID_COMMIT_SHA_SQL}
  AND d.detected_github_owner IS NOT NULL AND d.detected_github_repo_name IS NOT NULL
  AND COALESCE(verification_repo.default_branch, ma.default_branch) IS NOT NULL`

export async function wakeChangedSiblingWaiters(monitoredAppId: number): Promise<number> {
  const { rowCount } = await pool.query(
    `WITH changed AS (
       SELECT d.id
       FROM deployments d
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       ${REPOSITORY_JOIN}
       LEFT JOIN deployments candidate ON candidate.id = d.sibling_wait_candidate_id
       LEFT JOIN LATERAL (
         SELECT ar.status
         FROM application_repositories ar JOIN repositories linked ON linked.github_repo_id = ar.github_repo_id
         WHERE ar.monitored_app_id = d.monitored_app_id AND linked.id = verification_repo.id
           AND ar.status IN ('active', 'historical')
         ORDER BY (ar.status = 'active') DESC, ar.created_at DESC, ar.id DESC LIMIT 1
       ) link ON true
       WHERE d.monitored_app_id = $1 AND d.four_eyes_status = 'pending_sibling_resolution'
         AND d.sibling_next_attempt_at > now()
         AND (d.sibling_wait_checked_at IS NULL
              OR d.sibling_wait_checked_at <= now() - interval '15 minutes')
         AND (
           d.sibling_wait_basis IS NULL OR d.sibling_wait_basis->>'version' IS DISTINCT FROM '1'
           OR candidate.id IS NULL
           OR candidate.four_eyes_status IS DISTINCT FROM d.sibling_wait_basis->>'candidateStatus'
           OR candidate.commit_sha IS DISTINCT FROM d.commit_sha
           OR (candidate.created_at, candidate.id) >= (d.created_at, d.id)
           OR NOT EXISTS (
             SELECT 1 FROM deployments d WHERE d.id = candidate.id AND ${repositoryDeploymentSql('verification_repo.id')}
           )
           OR verification_repo.id::text IS DISTINCT FROM d.sibling_wait_basis->>'repositoryId'
           OR d.commit_sha IS DISTINCT FROM d.sibling_wait_basis->>'commitSha'
           OR COALESCE(verification_repo.default_branch, ma.default_branch)
                IS DISTINCT FROM d.sibling_wait_basis->>'configuredBaseBranch'
           OR verification_repo.audit_start_year::text IS DISTINCT FROM d.sibling_wait_basis->>'auditStartYear'
           OR COALESCE(verification_repo.implicit_approval_mode, 'off')
                IS DISTINCT FROM d.sibling_wait_basis->>'implicitApprovalMode'
           OR COALESCE(link.status, 'unknown') IS DISTINCT FROM d.sibling_wait_basis->>'repositoryStatus'
           OR EXISTS (
             SELECT 1 FROM deployments root
             WHERE root.commit_sha = d.commit_sha
               AND (root.created_at, root.id) <= (d.created_at, d.id)
               AND root.four_eyes_status IN (${ROOT_APPROVED_STATUSES_SQL})
               AND EXISTS (
                 SELECT 1 FROM deployments d WHERE d.id = root.id AND ${repositoryDeploymentSql('verification_repo.id')}
               )
           )
         )
     )
     UPDATE deployments d SET sibling_next_attempt_at = now(), sibling_retry_count = 0
     FROM changed WHERE d.id = changed.id AND d.four_eyes_status = 'pending_sibling_resolution'`,
    [monitoredAppId],
  )
  return rowCount ?? 0
}

export async function getDueSiblingWaiters(monitoredAppId: number): Promise<SiblingWork[]> {
  const { rows } = await pool.query<SiblingWork>(
    `${WORK_SELECT}
     WHERE d.monitored_app_id = $1 AND ${WAITER_READY_SQL}
       AND d.four_eyes_status = 'pending_sibling_resolution'
       AND (d.sibling_next_attempt_at IS NULL OR d.sibling_next_attempt_at <= now())
     ORDER BY d.sibling_next_attempt_at NULLS FIRST, d.created_at, d.id LIMIT $2`,
    [monitoredAppId, SIBLING_WAITER_LIMIT],
  )
  return rows
}

export async function getSiblingQueueStats(monitoredAppId: number): Promise<{
  waiting: number
  unavailable: number
  due: number
  oldestDueAt: Date | null
}> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS waiting,
       COUNT(*) FILTER (WHERE NOT COALESCE((${WAITER_READY_SQL}), false))::int AS unavailable,
       COUNT(*) FILTER (
         WHERE ${WAITER_READY_SQL} AND (d.sibling_next_attempt_at IS NULL OR d.sibling_next_attempt_at <= now())
       )::int AS due,
       MIN(COALESCE(d.sibling_next_attempt_at, d.created_at)) FILTER (
         WHERE ${WAITER_READY_SQL} AND (d.sibling_next_attempt_at IS NULL OR d.sibling_next_attempt_at <= now())
       ) AS "oldestDueAt"
     FROM deployments d JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     ${REPOSITORY_JOIN}
     WHERE d.monitored_app_id = $1 AND d.four_eyes_status = 'pending_sibling_resolution'`,
    [monitoredAppId],
  )
  return rows[0]
}

export async function getBlockingSiblingCandidates(): Promise<SiblingWork[]> {
  const { rows } = await pool.query<SiblingWork>(
    `${WORK_SELECT}
     WHERE ma.is_active = true AND d.four_eyes_status = 'unverified_commits'
       AND d.id IN (
         SELECT sibling_wait_candidate_id FROM deployments
         WHERE four_eyes_status = 'pending_sibling_resolution' AND sibling_wait_candidate_id IS NOT NULL
       )
       AND ${VALID_COMMIT_SHA_SQL}
       AND d.detected_github_owner IS NOT NULL AND d.detected_github_repo_name IS NOT NULL
       AND COALESCE(verification_repo.default_branch, ma.default_branch) IS NOT NULL
       AND (d.sibling_refresh_after IS NULL OR d.sibling_refresh_after <= now())
       AND ${BLOCKING_WAITER_SQL}
     ORDER BY d.sibling_refresh_after NULLS FIRST, d.created_at, d.id LIMIT $1`,
    [SIBLING_CANDIDATE_LIMIT],
  )
  return rows
}

export async function isBlockingSiblingCandidate(work: SiblingWork): Promise<boolean> {
  const { rows } = await pool.query(
    `${WORK_SELECT} WHERE d.id = $1 AND ma.is_active = true
       AND d.four_eyes_status = 'unverified_commits' AND ${BLOCKING_WAITER_SQL}`,
    [work.id],
  )
  return rows.length === 1
}

export function siblingRetryDelay(deploymentId: number, attempts: number, technical = false): number {
  const delays = technical
    ? [SIBLING_MIN_RETRY_MS, 60 * 60 * 1000]
    : [SIBLING_MIN_RETRY_MS, 3600000, 21600000, 86400000]
  const delay = delays[Math.min(Math.max(attempts, 0), delays.length - 1)]
  return Math.min(delay + (deploymentId % 61) * 1000, technical ? 3600000 : 86400000)
}

export async function deferSiblingWork(
  work: SiblingWork,
  candidate: boolean,
  retryAt: Date,
  attempted = false,
): Promise<boolean> {
  const field = candidate ? 'sibling_refresh_after' : 'sibling_next_attempt_at'
  const { rowCount } = await pool.query(
    `UPDATE deployments SET ${field} = $2,
       sibling_wait_checked_at = CASE WHEN $3 THEN clock_timestamp() ELSE sibling_wait_checked_at END,
       sibling_retry_count = sibling_retry_count + CASE WHEN $3 THEN 1 ELSE 0 END
     WHERE id = $1 AND four_eyes_status = $4
       AND ${field} IS NOT DISTINCT FROM $5::timestamptz
       AND sibling_wait_checked_at IS NOT DISTINCT FROM $6::timestamptz
       AND sibling_retry_count = $7 AND commit_sha = $8
       AND repository_id IS NOT DISTINCT FROM $9::int`,
    [
      work.id,
      retryAt,
      attempted,
      work.four_eyes_status,
      candidate ? work.sibling_refresh_after : work.sibling_next_attempt_at,
      work.sibling_wait_checked_at,
      work.sibling_retry_count,
      work.commit_sha,
      work.repository_id,
    ],
  )
  return Boolean(rowCount)
}

export async function lockSiblingWork(
  client: Pick<PoolClient, 'query'>,
  work: SiblingWork,
  rootId?: number,
): Promise<boolean> {
  await client.query('SELECT id FROM deployments WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [
    rootId == null ? [work.id] : [work.id, rootId],
  ])
  const { rows } = await client.query(
    `SELECT d.id FROM deployments d
     WHERE d.id = $1 AND d.four_eyes_status = $2 AND d.commit_sha = $3
       AND d.repository_id IS NOT DISTINCT FROM $4::int AND d.created_at = $5
       AND d.sibling_wait_checked_at IS NOT DISTINCT FROM $6::timestamptz
       AND d.sibling_next_attempt_at IS NOT DISTINCT FROM $7::timestamptz
       AND d.sibling_refresh_after IS NOT DISTINCT FROM $8::timestamptz
       AND d.sibling_retry_count = $9
       AND d.sibling_wait_basis IS NOT DISTINCT FROM $10::jsonb
       AND ${repositoryDeploymentSql('$11::int')}`,
    [
      work.id,
      work.four_eyes_status,
      work.commit_sha,
      work.repository_id,
      work.created_at,
      work.sibling_wait_checked_at,
      work.sibling_next_attempt_at,
      work.sibling_refresh_after,
      work.sibling_retry_count,
      work.sibling_wait_basis == null ? null : JSON.stringify(work.sibling_wait_basis),
      work.verification_repository_id,
    ],
  )
  return rows.length === 1
}

export async function isCurrentSiblingRoot(
  client: Pick<PoolClient, 'query'>,
  work: SiblingWork,
  rootId: number,
  expectedStatus: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT d.id FROM deployments d WHERE d.id = $1 AND d.commit_sha = $2
       AND d.four_eyes_status = $3 AND d.four_eyes_status IN (${ROOT_APPROVED_STATUSES_SQL})
       AND (d.created_at, d.id) < (SELECT created_at, id FROM deployments WHERE id = $4)
       AND ${repositoryDeploymentSql('$5::int')}`,
    [rootId, work.commit_sha, expectedStatus, work.id, work.verification_repository_id],
  )
  return rows.length === 1
}
