import { pool } from './connection.server'

export interface WorkflowRunRepositoryBackfillCoverage {
  repositoryId: number
  githubOwner: string
  githubRepoName: string
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
}

interface CoverageRow {
  repository_id: number
  github_owner: string
  github_repo_name: string
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
}

export async function getWorkflowRunRepositoryBackfillCoverage(): Promise<WorkflowRunRepositoryBackfillCoverage[]> {
  const { rows } = await pool.query<CoverageRow>(
    `WITH legacy_deployments AS (
       SELECT
         r.id AS repository_id,
         r.github_owner,
         r.github_repo_name,
         r.github_repo_id::text AS github_repo_id,
         d.id AS deployment_id,
         d.commit_sha,
         d.detected_github_owner,
         d.detected_github_repo_name,
         d.trigger_url,
         regexp_match(
           d.trigger_url,
           '^https://github[.]com/([^/?#]+)/([^/?#]+)/actions/runs/([0-9]+)(?:[/?#].*)?$',
           'i'
         ) AS run_parts
       FROM repositories r
       JOIN deployments d
         ON d.repository_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM application_repositories ar
          JOIN repositories linked_repository ON linked_repository.github_repo_id = ar.github_repo_id
          WHERE linked_repository.id = r.id
            AND ar.monitored_app_id = d.monitored_app_id
            AND ar.github_owner = d.detected_github_owner
            AND ar.github_repo_name = d.detected_github_repo_name
            AND ar.status IN ('active', 'historical')
        )
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
     snapshots AS (
       SELECT legacy_deployments.*,
              workflow_run.data AS workflow_run_data
       FROM legacy_deployments
       LEFT JOIN LATERAL (
         SELECT snapshot.data
         FROM github_workflow_runs_raw_snapshots snapshot
         WHERE snapshot.github_repo_id::text = legacy_deployments.github_repo_id
           AND snapshot.run_id::text = (legacy_deployments.run_parts)[3]
         ORDER BY snapshot.fetched_at DESC, snapshot.id DESC
         LIMIT 1
       ) workflow_run ON legacy_deployments.run_parts IS NOT NULL
     ),
     classified AS (
       SELECT *,
         CASE
           WHEN trigger_url IS NULL OR btrim(trigger_url) = '' THEN 'no_trigger_url'
           WHEN run_parts IS NULL THEN 'invalid_trigger_url'
           WHEN lower((run_parts)[1]) != lower(detected_github_owner)
             OR lower((run_parts)[2]) != lower(detected_github_repo_name) THEN 'trigger_url_mismatch'
           WHEN workflow_run_data IS NULL THEN 'missing_snapshot'
           WHEN github_repo_id IS NULL
             OR workflow_run_data->'repository'->>'id' IS DISTINCT FROM github_repo_id
             THEN 'repository_mismatch'
           WHEN commit_sha IS NULL
             OR lower(workflow_run_data->>'head_sha') IS DISTINCT FROM lower(commit_sha)
             THEN 'sha_mismatch'
           WHEN workflow_run_data->>'event' IS DISTINCT FROM 'push' THEN 'unsupported_event'
           WHEN workflow_run_data->'head_repository'->>'id' IS DISTINCT FROM github_repo_id
             THEN 'head_repository_mismatch'
           ELSE 'eligible'
         END AS classification
       FROM snapshots
     )
     SELECT
       repository_id,
       github_owner,
       github_repo_name,
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
     ORDER BY eligible DESC, total_legacy_deployments DESC, github_owner, github_repo_name`,
  )

  return rows.map((row) => ({
    repositoryId: row.repository_id,
    githubOwner: row.github_owner,
    githubRepoName: row.github_repo_name,
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
  }))
}
