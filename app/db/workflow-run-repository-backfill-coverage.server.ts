import { pool } from './connection.server'
import type { SyncJobStatus } from './sync-job-types'

export interface WorkflowRunRepositoryIdBackfillJob {
  id: number
  status: SyncJobStatus
  result: Record<string, unknown> | null
  error: string | null
  lockExpired: boolean
}

export interface WorkflowRunRepositoryBackfillCoverage {
  repositoryId: number
  githubOwner: string
  githubRepoName: string
  deploymentsWithRepositoryId: number
  totalLegacyDeployments: number
  eligible: number
  noTriggerUrl: number
  invalidTriggerUrl: number
  triggerUrlMismatch: number
  missingSnapshot: number
  repositoryMismatch: number
  shaMismatch: number
  unsupportedEvent: number
  headRepositoryMismatch: number
  backfillJob: WorkflowRunRepositoryIdBackfillJob | null
}

export interface WorkflowRunBackfillPreviewRepository {
  repositoryId: number
  githubOwner: string
  githubRepoName: string
}

export type WorkflowRunBackfillPreviewClassification =
  | 'eligible'
  | 'no_trigger_url'
  | 'invalid_trigger_url'
  | 'trigger_url_mismatch'
  | 'missing_snapshot'
  | 'repository_mismatch'
  | 'sha_mismatch'
  | 'unsupported_event'
  | 'head_repository_mismatch'

export interface WorkflowRunBackfillPreviewDeployment {
  deploymentId: number
  teamSlug: string
  appName: string
  environmentName: string
  createdAt: Date
  commitSha: string | null
  workflowRunId: string | null
  classification: WorkflowRunBackfillPreviewClassification
}

interface CoverageRow {
  repository_id: number
  github_owner: string
  github_repo_name: string
  deployments_with_repository_id: number
  total_legacy_deployments: number
  eligible: number
  no_trigger_url: number
  invalid_trigger_url: number
  trigger_url_mismatch: number
  missing_snapshot: number
  repository_mismatch: number
  sha_mismatch: number
  unsupported_event: number
  head_repository_mismatch: number
  backfill_job_id: number | null
  backfill_job_status: SyncJobStatus | null
  backfill_job_result: Record<string, unknown> | null
  backfill_job_error: string | null
  backfill_job_lock_expired: boolean
}

interface PreviewRepositoryRow {
  repository_id: number
  github_owner: string
  github_repo_name: string
}

interface PreviewDeploymentRow {
  deployment_id: number
  team_slug: string
  app_name: string
  environment_name: string
  created_at: Date
  commit_sha: string | null
  workflow_run_id: string | null
  classification: WorkflowRunBackfillPreviewClassification
}

export function classifiedWorkflowRunDeploymentsCte(scopeCondition: string): string {
  return `WITH legacy_deployments AS (
       SELECT
         r.id AS repository_id,
         r.github_owner,
         r.github_repo_name,
         r.github_repo_id,
         d.team_slug,
         d.app_name,
         d.environment_name,
         d.id AS deployment_id,
         d.created_at,
         d.commit_sha,
         d.detected_github_owner,
         d.detected_github_repo_name,
         d.trigger_url,
         regexp_match(
           d.trigger_url,
           '^https://github[.]com/([^/?#]+)/([^/?#]+)/actions/runs/([0-9]+)(?:[/?#].*)?$',
           'i'
         ) AS run_parts
       FROM monitored_applications ma
       JOIN application_repositories ar
         ON ar.monitored_app_id = ma.id
        AND ar.status IN ('active', 'historical')
       JOIN deployments d
         ON d.monitored_app_id = ma.id
        AND d.detected_github_owner = ar.github_owner
        AND d.detected_github_repo_name = ar.github_repo_name
        AND d.repository_id IS NULL
       JOIN repositories r ON r.github_repo_id = ar.github_repo_id
       WHERE ${scopeCondition}
        AND NOT EXISTS (
          SELECT 1
          FROM repositories other
          WHERE other.github_owner = d.detected_github_owner
            AND other.github_repo_name = d.detected_github_repo_name
            AND other.id != r.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM repository_name_history other
          WHERE other.github_owner = d.detected_github_owner
            AND other.github_repo_name = d.detected_github_repo_name
            AND other.repository_id != r.id
        )
     ),
     parsed_workflow_runs AS (
       SELECT legacy_deployments.*,
              CASE
                WHEN run_parts IS NULL THEN NULL
                WHEN length((run_parts)[3]) > 19 THEN NULL
                WHEN (run_parts)[3]::numeric BETWEEN 1 AND 9223372036854775807
                  THEN (run_parts)[3]::bigint
                ELSE NULL
              END AS workflow_run_id
       FROM legacy_deployments
     ),
     snapshots AS (
       SELECT parsed_workflow_runs.*,
              workflow_run.data AS workflow_run_data
       FROM parsed_workflow_runs
       LEFT JOIN LATERAL (
         SELECT snapshot.data
         FROM github_workflow_runs_raw_snapshots snapshot
         WHERE snapshot.github_repo_id = parsed_workflow_runs.github_repo_id
           AND snapshot.run_id = parsed_workflow_runs.workflow_run_id
         ORDER BY snapshot.fetched_at DESC, snapshot.id DESC
         LIMIT 1
       ) workflow_run ON parsed_workflow_runs.workflow_run_id IS NOT NULL
     ),
     classified AS (
       SELECT *,
         CASE
           WHEN trigger_url IS NULL OR btrim(trigger_url) = '' THEN 'no_trigger_url'
           WHEN run_parts IS NULL OR workflow_run_id IS NULL THEN 'invalid_trigger_url'
           WHEN lower((run_parts)[1]) != lower(detected_github_owner)
             OR lower((run_parts)[2]) != lower(detected_github_repo_name) THEN 'trigger_url_mismatch'
           WHEN workflow_run_data IS NULL THEN 'missing_snapshot'
           WHEN github_repo_id IS NULL
             OR workflow_run_data->'repository'->>'id' IS DISTINCT FROM github_repo_id::text
             THEN 'repository_mismatch'
           WHEN commit_sha IS NULL
             OR lower(workflow_run_data->>'head_sha') IS DISTINCT FROM lower(commit_sha)
             THEN 'sha_mismatch'
           WHEN workflow_run_data->>'event' IS DISTINCT FROM 'push' THEN 'unsupported_event'
           WHEN workflow_run_data->'head_repository'->>'id' IS DISTINCT FROM github_repo_id::text
             THEN 'head_repository_mismatch'
           ELSE 'eligible'
         END AS classification
       FROM snapshots
     )`
}

export async function getWorkflowRunBackfillCoverageTeams(): Promise<string[]> {
  const { rows } = await pool.query<{ team_slug: string }>(
    `SELECT DISTINCT team_slug
     FROM monitored_applications
     WHERE team_slug IS NOT NULL AND btrim(team_slug) <> ''
     ORDER BY team_slug`,
  )

  return rows.map((row) => row.team_slug)
}

export async function getWorkflowRunRepositoryBackfillCoverage(
  teamSlug: string,
): Promise<WorkflowRunRepositoryBackfillCoverage[]> {
  const { rows } = await pool.query<CoverageRow>(
    `${classifiedWorkflowRunDeploymentsCte('ma.team_slug = $1')}
     , coverage AS (
       SELECT repository_id, github_owner, github_repo_name,
         count(*)::int AS total_legacy_deployments,
         count(*) FILTER (WHERE classification = 'eligible')::int AS eligible,
         count(*) FILTER (WHERE classification = 'no_trigger_url')::int AS no_trigger_url,
         count(*) FILTER (WHERE classification = 'invalid_trigger_url')::int AS invalid_trigger_url,
         count(*) FILTER (WHERE classification = 'trigger_url_mismatch')::int AS trigger_url_mismatch,
         count(*) FILTER (WHERE classification = 'missing_snapshot')::int AS missing_snapshot,
         count(*) FILTER (WHERE classification = 'repository_mismatch')::int AS repository_mismatch,
         count(*) FILTER (WHERE classification = 'sha_mismatch')::int AS sha_mismatch,
         count(*) FILTER (WHERE classification = 'unsupported_event')::int AS unsupported_event,
         count(*) FILTER (WHERE classification = 'head_repository_mismatch')::int AS head_repository_mismatch
       FROM classified
       GROUP BY repository_id, github_owner, github_repo_name
     ),
     repositories_with_backfill_jobs AS (
       SELECT r.id AS repository_id, r.github_owner, r.github_repo_name
       FROM repositories r
       WHERE EXISTS (
         SELECT 1
         FROM sync_jobs sj
         WHERE sj.repository_id = r.id AND sj.job_type = 'backfill_github_repo_ids'
       )
         AND EXISTS (
           SELECT 1
           FROM monitored_applications ma
           JOIN application_repositories ar
             ON ar.monitored_app_id = ma.id
            AND ar.status IN ('active', 'historical')
           WHERE ma.team_slug = $1 AND ar.github_repo_id = r.github_repo_id
         )
     ),
     visible_repositories AS (
       SELECT repository_id, github_owner, github_repo_name FROM coverage
       UNION
       SELECT repository_id, github_owner, github_repo_name FROM repositories_with_backfill_jobs
     )
     SELECT visible.repository_id, visible.github_owner, visible.github_repo_name,
       COALESCE(deployment_count.deployments_with_repository_id, 0)::int AS deployments_with_repository_id,
       COALESCE(coverage.total_legacy_deployments, 0)::int AS total_legacy_deployments,
       COALESCE(coverage.eligible, 0)::int AS eligible,
       COALESCE(coverage.no_trigger_url, 0)::int AS no_trigger_url,
       COALESCE(coverage.invalid_trigger_url, 0)::int AS invalid_trigger_url,
       COALESCE(coverage.trigger_url_mismatch, 0)::int AS trigger_url_mismatch,
       COALESCE(coverage.missing_snapshot, 0)::int AS missing_snapshot,
       COALESCE(coverage.repository_mismatch, 0)::int AS repository_mismatch,
       COALESCE(coverage.sha_mismatch, 0)::int AS sha_mismatch,
       COALESCE(coverage.unsupported_event, 0)::int AS unsupported_event,
       COALESCE(coverage.head_repository_mismatch, 0)::int AS head_repository_mismatch,
       backfill_job.id AS backfill_job_id,
       backfill_job.status AS backfill_job_status,
       backfill_job.result AS backfill_job_result,
       backfill_job.error AS backfill_job_error,
       backfill_job.status = 'running'
         AND (backfill_job.lock_expires_at IS NULL OR backfill_job.lock_expires_at <= NOW()) AS backfill_job_lock_expired
     FROM visible_repositories visible
     LEFT JOIN coverage
       ON coverage.repository_id = visible.repository_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS deployments_with_repository_id
       FROM deployments
       WHERE repository_id = visible.repository_id
     ) deployment_count ON true
     LEFT JOIN LATERAL (
       SELECT id, status, result, error, lock_expires_at
       FROM sync_jobs
       WHERE repository_id = visible.repository_id
         AND job_type = 'backfill_github_repo_ids'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) backfill_job ON true
     ORDER BY eligible DESC, total_legacy_deployments DESC, visible.github_owner, visible.github_repo_name`,
    [teamSlug],
  )

  return rows.map((row) => ({
    repositoryId: row.repository_id,
    githubOwner: row.github_owner,
    githubRepoName: row.github_repo_name,
    deploymentsWithRepositoryId: row.deployments_with_repository_id,
    totalLegacyDeployments: row.total_legacy_deployments,
    eligible: row.eligible,
    noTriggerUrl: row.no_trigger_url,
    invalidTriggerUrl: row.invalid_trigger_url,
    triggerUrlMismatch: row.trigger_url_mismatch,
    missingSnapshot: row.missing_snapshot,
    repositoryMismatch: row.repository_mismatch,
    shaMismatch: row.sha_mismatch,
    unsupportedEvent: row.unsupported_event,
    headRepositoryMismatch: row.head_repository_mismatch,
    backfillJob:
      row.backfill_job_id === null || row.backfill_job_id === undefined
        ? null
        : {
            id: row.backfill_job_id,
            status: row.backfill_job_status ?? 'failed',
            result: row.backfill_job_result,
            error: row.backfill_job_error,
            lockExpired: row.backfill_job_lock_expired,
          },
  }))
}

export async function getWorkflowRunRepositoryBackfillJobStatus(
  repositoryId: number,
): Promise<WorkflowRunRepositoryIdBackfillJob | null> {
  const { rows } = await pool.query<{
    id: number
    status: SyncJobStatus
    result: Record<string, unknown> | null
    error: string | null
    lock_expired: boolean
  }>(
    `SELECT id, status, result, error,
       status = 'running' AND (lock_expires_at IS NULL OR lock_expires_at <= NOW()) AS lock_expired
     FROM sync_jobs
     WHERE repository_id = $1 AND job_type = 'backfill_github_repo_ids'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [repositoryId],
  )
  const job = rows[0]

  return job
    ? {
        id: job.id,
        status: job.status,
        result: job.result,
        error: job.error,
        lockExpired: job.lock_expired,
      }
    : null
}

export async function getWorkflowRunBackfillPreviewRepository(
  repositoryId: number,
): Promise<WorkflowRunBackfillPreviewRepository | null> {
  const { rows } = await pool.query<PreviewRepositoryRow>(
    `SELECT id AS repository_id, github_owner, github_repo_name
     FROM repositories
     WHERE id = $1`,
    [repositoryId],
  )
  const repository = rows[0]

  return repository
    ? {
        repositoryId: repository.repository_id,
        githubOwner: repository.github_owner,
        githubRepoName: repository.github_repo_name,
      }
    : null
}

export async function getWorkflowRunRepositoryBackfillPreview(
  repositoryId: number,
): Promise<WorkflowRunBackfillPreviewDeployment[]> {
  const { rows } = await pool.query<PreviewDeploymentRow>(
    `${classifiedWorkflowRunDeploymentsCte('r.id = $1')}
     SELECT
       deployment_id,
       team_slug,
       app_name,
       environment_name,
       created_at,
       commit_sha,
       workflow_run_id::text AS workflow_run_id,
       classification
     FROM classified
     ORDER BY created_at DESC, deployment_id DESC`,
    [repositoryId],
  )

  return rows.map((row) => ({
    deploymentId: row.deployment_id,
    teamSlug: row.team_slug,
    appName: row.app_name,
    environmentName: row.environment_name,
    createdAt: row.created_at,
    commitSha: row.commit_sha,
    workflowRunId: row.workflow_run_id,
    classification: row.classification,
  }))
}

export async function backfillEligibleWorkflowRunRepositoryIds(repositoryId: number): Promise<number> {
  const { rows } = await pool.query<{ updated: number }>(
    `${classifiedWorkflowRunDeploymentsCte('r.id = $1')},
     updated_deployments AS (
       UPDATE deployments d
       SET repository_id = $1
       FROM classified c
       WHERE d.id = c.deployment_id
         AND d.repository_id IS NULL
         AND c.classification = 'eligible'
       RETURNING d.id
     )
     SELECT count(*)::int AS updated FROM updated_deployments`,
    [repositoryId],
  )

  return rows[0]?.updated ?? 0
}
