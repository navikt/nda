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

function classifiedDeploymentsCte(scopeCondition: string): string {
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
    `${classifiedDeploymentsCte('ma.team_slug = $1')}
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
    [teamSlug],
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
    `${classifiedDeploymentsCte('r.id = $1')}
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
