import type { PoolClient } from 'pg'
import {
  parseRepositoryDeliveryComparisonRange,
  parseRepositoryDeliveryReviews,
  type RepositoryDeliveryComparisonRange,
  type RepositoryDeliveryReviewEvidence,
} from '~/lib/repository-code-delivery/evidence'
import type { RepositoryDeliveryIntervalAssessment } from '~/lib/repository-code-delivery/interval-assessment'
import type { ImplicitApprovalMode } from '~/lib/verification/types'
import { pool, withTransaction } from './connection.server'
import {
  getRepositoryAssessmentDiagnostic,
  type RepositoryAssessmentDiagnostic,
} from './repository-assessment-diagnostic.server'
import { REPOSITORY_CODE_DELIVERY_ASSESSMENT_VERSION } from './repository-code-delivery-assessment-sync.server'
import type { UnresolvedReason } from './repository-code-delivery-establishment.server'
import { getRepositoryCodeDeliveryIntervalAssessments } from './repository-code-delivery-interval-assessment.server'

export interface RepositoryCodeDeliveryOverview {
  deliveryCount: number
  linkedDeploymentCount: number
  awaitingDeploymentCount: number
  unresolvedByReason: Partial<Record<UnresolvedReason, number>>
}

interface RepositoryHistoryApplicationReadiness {
  team_slug: string
  environment_name: string
  app_name: string
  is_active: boolean
  initial_nais_history_synced_at: Date | null
  deployment_count: number
  repository_deployment_count: number
  unassigned_deployment_count: number
  other_repository_deployment_count: number
  repository_deployments_missing_sha: number
}

export interface RepositoryHistoryReadiness {
  applications: RepositoryHistoryApplicationReadiness[]
  repositoryDeploymentCount: number
  repositoryDeploymentsMissingShaCount: number
  repositoryDeploymentsWithoutKnownAppLinkCount: number
}

export interface RepositoryCodeDeliveryExportRow {
  deployment_id: number
  nais_deployment_id: string | null
  deployment_source: 'nais_deployment' | 'nais_apply'
  deployment_source_id: string | null
  deployed_at: Date
  team_slug: string
  app_name: string
  environment_name: string
  deployed_sha: string | null
  branch_name: string | null
  trigger_url: string | null
  github_pr_number: number | null
  delivery_id: number | null
  delivery_base_sha: string | null
  delivery_head_sha: string | null
  delivery_registered_at: Date | null
  delivery_first_deployed_at: Date | null
  unresolved_reason: UnresolvedReason | null
  unresolved_first_seen_at: Date | null
  unresolved_last_attempt_at: Date | null
  unresolved_resolved_at: Date | null
  tracking_since: Date | null
  default_branch: string | null
}

export interface RepositoryCodeDeliveryExportDelivery {
  id: number
  base_sha: string
  head_sha: string
  registered_at: Date
  first_deployed_at: Date | null
  deployment_count: number
  contexts: Array<{ unresolvedDeploymentId: number; relativePosition: 'before' | 'after' }>
}

export interface RepositoryVerificationRunExportRow {
  id: number
  deployment_id: number
  run_at: Date
  schema_version: number
  pr_snapshot_ids: number[]
  commit_snapshot_ids: number[]
  result: unknown
  status: string
}

export interface RepositoryConfigAuditExportRow {
  id: number
  setting_key: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown>
  changed_by_nav_ident: string
  changed_by_name: string | null
  change_reason: string | null
  created_at: Date
}

export interface RepositoryGitHubPrSnapshotExportRow {
  id: number
  owner: string
  repo: string
  pr_number: number
  schema_version: number
  fetched_at: Date
  data_type: string
  source: string
  github_available: boolean
  data: unknown
}

export interface RepositoryGitHubCommitSnapshotExportRow {
  id: number
  owner: string
  repo: string
  sha: string
  schema_version: number
  fetched_at: Date
  data_type: string
  source: string
  github_available: boolean
  data: unknown
}

export interface RepositoryWorkflowRunSnapshotExportRow {
  id: number
  run_id: string
  github_repo_id: string
  owner: string
  repo: string
  api_version: string
  api_deprecated_at: Date | null
  api_sunset_at: Date | null
  fetched_at: Date
  data: unknown
}

export interface RepositoryCodeDeliveryDiagnosticTarget {
  unresolvedDeploymentId: number
  unresolvedDeployedAt: Date
  nearbyDeliveryCountPerSide: number
  includedDeliveryIds: number[]
  includedDeploymentIds: number[]
}

export interface RepositoryCodeDeliveryDiagnosticDeliveryTarget {
  deliveryId: number
  includedDeploymentIds: number[]
}

export interface RepositoryCodeDeliveryRepositoryAlias {
  owner: string
  repo: string
}

export interface RepositoryCodeDeliveryExportData {
  repositoryAssessments: RepositoryAssessmentDiagnostic
  repositoryMetadata: {
    github_repo_id: string
    github_owner: string
    github_repo_name: string
    default_branch: string | null
    code_delivery_tracking_since: Date | null
    audit_start_year: number | null
  }
  repositoryAliases: RepositoryCodeDeliveryRepositoryAlias[]
  deployments: RepositoryCodeDeliveryExportRow[]
  deliveries: RepositoryCodeDeliveryExportDelivery[]
  ancestryEvidence: RepositoryCodeDeliveryAncestryEvidence[]
  historyReadiness: RepositoryHistoryReadiness
  verificationRuns: RepositoryVerificationRunExportRow[]
  repositoryConfigAuditLog: RepositoryConfigAuditExportRow[]
  diagnosticTargets: RepositoryCodeDeliveryDiagnosticTarget[]
  deliveryTarget: RepositoryCodeDeliveryDiagnosticDeliveryTarget | null
  implicitApprovalMode: ImplicitApprovalMode
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[]
  commitSnapshots: RepositoryGitHubCommitSnapshotExportRow[]
  workflowRunSnapshots: RepositoryWorkflowRunSnapshotExportRow[]
}

export interface RepositoryCodeDeliveryAncestryEvidence {
  unresolved_deployment_id: number
  unresolved_deployed_sha: string
  unresolved_deployed_at: Date
  unresolved_reason: UnresolvedReason
  unresolved_first_seen_at: Date
  unresolved_last_attempt_at: Date
  delivery_id: number
  delivery_head_sha: string
  compare_base_sha: string
  compare_head_sha: string
  compare_status: string | null
  compare_ahead_by: number | null
  compare_behind_by: number | null
  compare_total_commits: number | null
  compare_commit_shas: string[]
  compare_fetched_at: Date
  compare_api_version: string
  compare_api_deprecated_at: Date | null
  compare_api_sunset_at: Date | null
  fetched_between_observations: boolean
}

export interface RepositoryCodeDeliverySummary {
  id: number
  base_sha: string
  head_sha: string
  created_at: Date
  first_deployed_at: Date | null
  is_anchor: boolean
  deployment_count: number
  app_names: string[]
}

interface RepositoryCodeDeliveryReviewSnapshot {
  id: number
  pr_number: number
  schema_version: number
  fetched_at: Date
  source: string
  github_available: boolean
  reviews: RepositoryDeliveryReviewEvidence[] | null
}

interface RepositoryCodeDeliveryVerificationEvidence {
  id: number
  run_at: Date
  schema_version: number
  status: string
  comparison_range: RepositoryDeliveryComparisonRange | null
  comparison_range_invalid: boolean
  review_snapshots: RepositoryCodeDeliveryReviewSnapshot[]
}

interface RepositoryCodeDeliveryDeploymentEvidence {
  id: number
  deployed_at: Date
  team_slug: string
  environment_name: string
  app_name: string
  verification_runs: RepositoryCodeDeliveryVerificationEvidence[]
}

export interface RepositoryCodeDeliveryEvidence {
  id: number
  base_sha: string
  head_sha: string
  created_at: Date
  first_deployed_at?: Date | null
  assessment_sync: {
    status:
      | 'tracking_disabled'
      | 'not_queued'
      | 'queued'
      | 'processing'
      | 'retry_wait'
      | 'outdated'
      | 'completed'
      | 'permanently_failed'
    attempt_count: number
    next_attempt_at: string | null
    locked_until: string | null
    completed_at: string | null
    completed_assessment_version: number
    last_error: string | null
    updated_at: string | null
    completed_association_snapshots: number
    completed_pull_request_snapshots: number
    stack_parent_pull_requests: number
  }
  interval_assessment: RepositoryDeliveryIntervalAssessment
  page: number
  totalPages: number
  totalEvidenceEntries: number
  deployments: RepositoryCodeDeliveryDeploymentEvidence[]
}

const REPOSITORY_CODE_DELIVERY_EVIDENCE_PAGE_SIZE = 25

export type RepositoryCodeDeliverySortKey =
  | 'first_deployed_at'
  | 'created_at'
  | 'base_sha'
  | 'head_sha'
  | 'deployment_count'
  | 'app_names'

export type RepositoryCodeDeliverySortDirection = 'ascending' | 'descending'

export async function listRepositoryCodeDeliveryExportRows(
  repositoryId: number,
  executor: Pick<PoolClient, 'query'> = pool,
  deploymentIds?: number[],
): Promise<RepositoryCodeDeliveryExportRow[]> {
  const { rows } = await executor.query<RepositoryCodeDeliveryExportRow>(
    `SELECT d.id AS deployment_id, d.nais_deployment_id, d.deployment_source, d.deployment_source_id,
            d.created_at AS deployed_at,
            d.team_slug, d.app_name, d.environment_name, d.commit_sha AS deployed_sha, d.branch_name, d.trigger_url,
            d.github_pr_number,
            c.id AS delivery_id, c.base_sha AS delivery_base_sha, c.head_sha AS delivery_head_sha,
            c.created_at AS delivery_registered_at, delivery_first.first_deployed_at AS delivery_first_deployed_at,
            u.reason AS unresolved_reason, u.created_at AS unresolved_first_seen_at,
            u.updated_at AS unresolved_last_attempt_at, u.resolved_at AS unresolved_resolved_at,
            r.code_delivery_tracking_since AS tracking_since, r.default_branch
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     JOIN repositories r ON r.id = d.repository_id
     LEFT JOIN repository_code_deliveries c ON c.id = d.repository_code_delivery_id
     LEFT JOIN LATERAL (
       SELECT min(linked.created_at) AS first_deployed_at
       FROM deployments linked
       JOIN monitored_applications linked_app ON linked_app.id = linked.monitored_app_id
       WHERE linked.repository_code_delivery_id = c.id
     ) delivery_first ON true
     LEFT JOIN repository_code_delivery_unresolved u ON u.deployment_id = d.id
     WHERE d.repository_id = $1
       AND ($2::int[] IS NULL OR d.id = ANY($2::int[]))
     ORDER BY d.created_at ASC, d.id ASC`,
    [repositoryId, deploymentIds ?? null],
  )
  return rows
}

export async function listRepositoryCodeDeliveryAncestryEvidence(
  repositoryId: number,
  executor: Pick<PoolClient, 'query'> = pool,
  unresolvedDeploymentIds?: number[],
  candidateDeliveryIds?: number[],
  candidatePairs?: Array<{ unresolvedDeploymentId: number; deliveryId: number }>,
): Promise<RepositoryCodeDeliveryAncestryEvidence[]> {
  const { rows } = await executor.query<RepositoryCodeDeliveryAncestryEvidence>(
    `SELECT d.id AS unresolved_deployment_id, d.commit_sha AS unresolved_deployed_sha,
            d.created_at AS unresolved_deployed_at, u.reason AS unresolved_reason,
            u.created_at AS unresolved_first_seen_at, u.updated_at AS unresolved_last_attempt_at,
            c.id AS delivery_id, c.head_sha AS delivery_head_sha,
            s.base_sha AS compare_base_sha, s.head_sha AS compare_head_sha,
            s.data->>'status' AS compare_status,
            NULLIF(s.data->>'ahead_by', '')::int AS compare_ahead_by,
            NULLIF(s.data->>'behind_by', '')::int AS compare_behind_by,
            NULLIF(s.data->>'total_commits', '')::int AS compare_total_commits,
            COALESCE(
              (SELECT array_agg(commit_value->>'sha' ORDER BY ordinal)
               FROM jsonb_array_elements(s.data->'commits') WITH ORDINALITY AS commit_rows(commit_value, ordinal)),
              '{}'
            ) AS compare_commit_shas,
            s.fetched_at AS compare_fetched_at, s.api_version AS compare_api_version,
            s.api_deprecated_at AS compare_api_deprecated_at, s.api_sunset_at AS compare_api_sunset_at,
            s.fetched_at BETWEEN u.created_at AND u.updated_at AS fetched_between_observations
     FROM repository_code_delivery_unresolved u
     JOIN deployments d ON d.id = u.deployment_id
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     JOIN repositories r ON r.id = d.repository_id
     JOIN repository_code_deliveries c ON c.repository_id = r.id
     JOIN github_compare_raw_snapshots s
       ON s.github_repo_id = r.github_repo_id
      AND (
        (lower(s.base_sha) = lower(c.head_sha) AND lower(s.head_sha) = lower(d.commit_sha))
        OR (lower(s.base_sha) = lower(d.commit_sha) AND lower(s.head_sha) = lower(c.head_sha))
      )
     WHERE r.id = $1
       AND u.reason IN ('ancestry_unknown', 'ancestry_diverged', 'ancestry_behind')
       AND ($2::int[] IS NULL OR d.id = ANY($2::int[]))
       AND ($3::int[] IS NULL OR c.id = ANY($3::int[]))
       AND (
         $4::int[] IS NULL
         OR EXISTS (
           SELECT 1
           FROM unnest($4::int[], $5::int[]) AS allowed_pairs(unresolved_deployment_id, delivery_id)
           WHERE allowed_pairs.unresolved_deployment_id = d.id
             AND allowed_pairs.delivery_id = c.id
         )
       )
     ORDER BY d.created_at, d.id, s.fetched_at`,
    [
      repositoryId,
      unresolvedDeploymentIds ?? null,
      candidateDeliveryIds ?? null,
      candidatePairs?.map((pair) => pair.unresolvedDeploymentId) ?? null,
      candidatePairs?.map((pair) => pair.deliveryId) ?? null,
    ],
  )
  return rows
}

async function listRepositoryVerificationRuns(
  deploymentIds: number[],
  executor: Pick<PoolClient, 'query'>,
): Promise<RepositoryVerificationRunExportRow[]> {
  const { rows } = await executor.query<RepositoryVerificationRunExportRow>(
    `SELECT vr.id, vr.deployment_id, vr.run_at, vr.schema_version,
            vr.pr_snapshot_ids, vr.commit_snapshot_ids, vr.result, vr.status
     FROM verification_runs vr
     JOIN deployments d ON d.id = vr.deployment_id
     WHERE d.id = ANY($1::int[])
     ORDER BY d.created_at ASC, d.id ASC, vr.run_at ASC, vr.id ASC`,
    [deploymentIds],
  )
  return rows
}

async function listRepositoryConfigAuditLog(
  repositoryId: number,
  executor: Pick<PoolClient, 'query'>,
): Promise<RepositoryConfigAuditExportRow[]> {
  const { rows } = await executor.query<RepositoryConfigAuditExportRow>(
    `SELECT id, setting_key, old_value, new_value, changed_by_nav_ident,
            changed_by_name, change_reason, created_at
     FROM repo_config_audit_log
     WHERE repository_id = $1
     ORDER BY created_at ASC, id ASC`,
    [repositoryId],
  )
  return rows
}

async function listReferencedRepositorySnapshots(
  verificationRuns: RepositoryVerificationRunExportRow[],
  executor: Pick<PoolClient, 'query'>,
): Promise<{
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[]
  commitSnapshots: RepositoryGitHubCommitSnapshotExportRow[]
}> {
  const prSnapshotIds = [...new Set(verificationRuns.flatMap((run) => run.pr_snapshot_ids))]
  const commitSnapshotIds = [...new Set(verificationRuns.flatMap((run) => run.commit_snapshot_ids))]
  const [prResult, commitResult] = await Promise.all([
    prSnapshotIds.length > 0
      ? executor.query<RepositoryGitHubPrSnapshotExportRow>(
          `SELECT id, owner, repo, pr_number, schema_version, fetched_at,
                  data_type, source, github_available, data
           FROM github_pr_snapshots
           WHERE id = ANY($1::int[])
           ORDER BY id`,
          [prSnapshotIds],
        )
      : Promise.resolve({ rows: [] as RepositoryGitHubPrSnapshotExportRow[] }),
    commitSnapshotIds.length > 0
      ? executor.query<RepositoryGitHubCommitSnapshotExportRow>(
          `SELECT id, owner, repo, sha, schema_version, fetched_at,
                  data_type, source, github_available, data
           FROM github_commit_snapshots
           WHERE id = ANY($1::int[])
           ORDER BY id`,
          [commitSnapshotIds],
        )
      : Promise.resolve({ rows: [] as RepositoryGitHubCommitSnapshotExportRow[] }),
  ])
  return { prSnapshots: prResult.rows, commitSnapshots: commitResult.rows }
}

async function listNearbyCodeDeliveries(
  repositoryId: number,
  unresolvedDeploymentId: number | undefined,
  executor: Pick<PoolClient, 'query'>,
): Promise<{
  targets: Array<{ unresolved_deployment_id: number; unresolved_deployed_at: Date }>
  deliveries: Array<
    Omit<RepositoryCodeDeliveryExportDelivery, 'contexts'> & {
      unresolved_deployment_id: number
      relative_position: 'before' | 'after'
    }
  >
}> {
  const { rows } = await executor.query<
    Omit<RepositoryCodeDeliveryExportDelivery, 'contexts'> & {
      unresolved_deployment_id: number | null
      unresolved_deployed_at: Date | null
      first_deployment_id: number | null
      relative_position: 'before' | 'after' | null
    }
  >(
    `WITH targets AS (
       SELECT d.id AS unresolved_deployment_id, d.created_at AS unresolved_deployed_at
       FROM deployments d
      JOIN monitored_applications ma ON ma.id = d.monitored_app_id
      JOIN repository_code_delivery_unresolved u ON u.deployment_id = d.id
      WHERE d.repository_id = $1
        AND u.resolved_at IS NULL
         AND ($2::int IS NULL OR d.id = $2)
     ),
     delivery_timeline AS (
       SELECT c.id, c.base_sha, c.head_sha, c.created_at AS registered_at,
              first_deployment.first_deployment_id, first_deployment.first_deployed_at,
              count(d.id)::int AS deployment_count
       FROM repository_code_deliveries c
       LEFT JOIN deployments d ON d.repository_code_delivery_id = c.id
       LEFT JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       LEFT JOIN LATERAL (
         SELECT deployment.id AS first_deployment_id, deployment.created_at AS first_deployed_at
         FROM deployments deployment
         JOIN monitored_applications deployment_app ON deployment_app.id = deployment.monitored_app_id
         WHERE deployment.repository_code_delivery_id = c.id
         ORDER BY deployment.created_at, deployment.id
         LIMIT 1
       ) first_deployment ON true
       WHERE c.repository_id = $1
       GROUP BY c.id, first_deployment.first_deployment_id, first_deployment.first_deployed_at
     ),
     adjacent_deliveries AS (
       SELECT targets.unresolved_deployment_id, targets.unresolved_deployed_at, adjacent.*
       FROM targets
       CROSS JOIN LATERAL (
         (SELECT delivery_timeline.*, 'before'::text AS relative_position
          FROM delivery_timeline
          WHERE (first_deployed_at, first_deployment_id) <=
                (targets.unresolved_deployed_at, targets.unresolved_deployment_id)
          ORDER BY first_deployed_at DESC, first_deployment_id DESC, id DESC
          LIMIT 2)
         UNION ALL
         (SELECT delivery_timeline.*, 'after'::text AS relative_position
          FROM delivery_timeline
          WHERE (first_deployed_at, first_deployment_id) >
                (targets.unresolved_deployed_at, targets.unresolved_deployment_id)
          ORDER BY first_deployed_at ASC, first_deployment_id ASC, id ASC
          LIMIT 2)
       ) adjacent
     )
     SELECT targets.unresolved_deployment_id, targets.unresolved_deployed_at,
            adjacent_deliveries.id, adjacent_deliveries.base_sha, adjacent_deliveries.head_sha,
            adjacent_deliveries.registered_at, adjacent_deliveries.first_deployed_at,
            adjacent_deliveries.first_deployment_id,
            adjacent_deliveries.deployment_count, adjacent_deliveries.relative_position
     FROM targets
     LEFT JOIN adjacent_deliveries USING (unresolved_deployment_id, unresolved_deployed_at)
     ORDER BY targets.unresolved_deployed_at, targets.unresolved_deployment_id,
              adjacent_deliveries.first_deployed_at, adjacent_deliveries.first_deployment_id,
              adjacent_deliveries.id`,
    [repositoryId, unresolvedDeploymentId ?? null],
  )
  const targetMap = new Map<number, Date>()
  const deliveries: Array<
    Omit<RepositoryCodeDeliveryExportDelivery, 'contexts'> & {
      unresolved_deployment_id: number
      relative_position: 'before' | 'after'
    }
  > = []
  for (const row of rows) {
    if (row.unresolved_deployment_id !== null && row.unresolved_deployed_at !== null) {
      targetMap.set(row.unresolved_deployment_id, row.unresolved_deployed_at)
    }
    if (row.unresolved_deployment_id !== null && row.id !== null && row.relative_position !== null) {
      deliveries.push({
        id: row.id,
        base_sha: row.base_sha,
        head_sha: row.head_sha,
        registered_at: row.registered_at,
        first_deployed_at: row.first_deployed_at,
        deployment_count: row.deployment_count,
        unresolved_deployment_id: row.unresolved_deployment_id,
        relative_position: row.relative_position,
      })
    }
  }
  return {
    targets: [...targetMap].map(([unresolved_deployment_id, unresolved_deployed_at]) => ({
      unresolved_deployment_id,
      unresolved_deployed_at,
    })),
    deliveries,
  }
}

async function listWorkflowRunSnapshots(
  repositoryId: number,
  deploymentIds: number[],
  executor: Pick<PoolClient, 'query'>,
): Promise<RepositoryWorkflowRunSnapshotExportRow[]> {
  if (deploymentIds.length === 0) return []
  const { rows } = await executor.query<RepositoryWorkflowRunSnapshotExportRow>(
    `WITH selected_deployments AS (
       SELECT d.id, parsed.run_parts
       FROM deployments d
       JOIN repositories r ON r.id = d.repository_id
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       CROSS JOIN LATERAL regexp_match(
         d.trigger_url,
         '^https://github[.]com/([^/?#]+)/([^/?#]+)/actions/runs/([0-9]+)(?:[/?#].*)?$',
         'i'
       ) AS parsed(run_parts)
       WHERE d.repository_id = $1 AND d.id = ANY($2::int[])
         AND (
           (
             lower(parsed.run_parts[1]) = lower(r.github_owner)
             AND lower(parsed.run_parts[2]) = lower(r.github_repo_name)
           )
           OR EXISTS (
             SELECT 1
             FROM repository_name_history name_history
             WHERE name_history.repository_id = r.id
               AND lower(parsed.run_parts[1]) = lower(name_history.github_owner)
               AND lower(parsed.run_parts[2]) = lower(name_history.github_repo_name)
           )
         )
     )
     SELECT DISTINCT snapshot.id, snapshot.run_id::text, snapshot.github_repo_id::text,
            snapshot.owner, snapshot.repo,
            snapshot.api_version, snapshot.api_deprecated_at, snapshot.api_sunset_at,
            snapshot.fetched_at, snapshot.data
     FROM selected_deployments d
     JOIN repositories r ON r.id = $1
     JOIN github_workflow_runs_raw_snapshots snapshot
       ON snapshot.github_repo_id = r.github_repo_id
       AND snapshot.run_id::text = d.run_parts[3]
     ORDER BY run_id, fetched_at, id`,
    [repositoryId, deploymentIds],
  )
  return rows
}

export async function getRepositoryCodeDeliveryExportData(
  repositoryId: number,
  unresolvedDeploymentId?: number,
): Promise<RepositoryCodeDeliveryExportData> {
  return getRepositoryCodeDeliveryExportDataForTarget(repositoryId, { unresolvedDeploymentId })
}

export async function getRepositoryCodeDeliveryDiagnosticForDelivery(
  repositoryId: number,
  deliveryId: number,
): Promise<RepositoryCodeDeliveryExportData> {
  return getRepositoryCodeDeliveryExportDataForTarget(repositoryId, { deliveryId })
}

async function getRepositoryCodeDeliveryExportDataForTarget(
  repositoryId: number,
  target: { unresolvedDeploymentId?: number; deliveryId?: number },
): Promise<RepositoryCodeDeliveryExportData> {
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const {
      rows: [repository],
    } = await client.query<{
      github_repo_id: string
      github_owner: string
      github_repo_name: string
      default_branch: string | null
      code_delivery_tracking_since: Date | null
      audit_start_year: number | null
      implicit_approval_mode: ImplicitApprovalMode
    }>(
      `SELECT github_repo_id, github_owner, github_repo_name, default_branch,
              code_delivery_tracking_since, audit_start_year, implicit_approval_mode
       FROM repositories WHERE id = $1`,
      [repositoryId],
    )
    const deliveryTargetResult =
      target.deliveryId === undefined
        ? null
        : await client.query<Omit<RepositoryCodeDeliveryExportDelivery, 'contexts'>>(
            `SELECT c.id, c.base_sha, c.head_sha, c.created_at AS registered_at,
                    min(d.created_at) AS first_deployed_at, count(d.id)::int AS deployment_count
             FROM repository_code_deliveries c
             LEFT JOIN deployments d ON d.repository_code_delivery_id = c.id
             WHERE c.repository_id = $1 AND c.id = $2
             GROUP BY c.id`,
            [repositoryId, target.deliveryId],
          )
    const deliveryTarget = deliveryTargetResult?.rows[0] ?? null
    const nearby =
      target.deliveryId === undefined
        ? await listNearbyCodeDeliveries(repositoryId, target.unresolvedDeploymentId, client)
        : { targets: [], deliveries: [] }
    const [repositoryConfigAuditLog, historyReadiness, repositoryAliases] = await Promise.all([
      listRepositoryConfigAuditLog(repositoryId, client),
      getRepositoryHistoryReadinessFromClient(repositoryId, client),
      client
        .query<RepositoryCodeDeliveryRepositoryAlias>(
          `SELECT github_owner AS owner, github_repo_name AS repo
           FROM repository_name_history
           WHERE repository_id = $1
           ORDER BY github_owner, github_repo_name`,
          [repositoryId],
        )
        .then(({ rows }) => rows),
    ])
    const {
      github_repo_id,
      github_owner,
      github_repo_name,
      default_branch,
      code_delivery_tracking_since,
      audit_start_year,
    } = repository
    const includedDeliveryIds = deliveryTarget
      ? [deliveryTarget.id]
      : [...new Set(nearby.deliveries.map((delivery) => delivery.id))]
    const unresolvedDeploymentIds = nearby.targets.map((target) => target.unresolved_deployment_id)
    const { rows: includedDeploymentRows } = await client.query<{
      id: number
      repository_code_delivery_id: number | null
    }>(
      `SELECT deployments.id, deployments.repository_code_delivery_id
       FROM deployments
       JOIN monitored_applications ma ON ma.id = deployments.monitored_app_id
       WHERE deployments.repository_id = $1
         AND (deployments.id = ANY($2::int[]) OR deployments.repository_code_delivery_id = ANY($3::int[]))
       ORDER BY deployments.created_at, deployments.id`,
      [repositoryId, unresolvedDeploymentIds, includedDeliveryIds],
    )
    const includedDeploymentIds = includedDeploymentRows.map((row) => row.id)
    const deploymentsByDelivery = new Map<number, number[]>()
    for (const row of includedDeploymentRows) {
      if (row.repository_code_delivery_id === null) continue
      const deploymentIds = deploymentsByDelivery.get(row.repository_code_delivery_id) ?? []
      deploymentIds.push(row.id)
      deploymentsByDelivery.set(row.repository_code_delivery_id, deploymentIds)
    }
    const diagnosticTargets = nearby.targets.map((target) => {
      const targetDeliveries = nearby.deliveries.filter(
        (delivery) => delivery.unresolved_deployment_id === target.unresolved_deployment_id,
      )
      const includedDeliveryIdsForTarget = targetDeliveries.map((delivery) => delivery.id)
      const targetIncludedDeploymentIds = new Set([
        target.unresolved_deployment_id,
        ...includedDeliveryIdsForTarget.flatMap((deliveryId) => deploymentsByDelivery.get(deliveryId) ?? []),
      ])
      return {
        unresolvedDeploymentId: target.unresolved_deployment_id,
        unresolvedDeployedAt: target.unresolved_deployed_at,
        nearbyDeliveryCountPerSide: 2,
        includedDeliveryIds: includedDeliveryIdsForTarget,
        includedDeploymentIds: includedDeploymentIds.filter((id) => targetIncludedDeploymentIds.has(id)),
      }
    })
    const includedDeliveryContexts = new Map<
      number,
      Array<{ unresolvedDeploymentId: number; relativePosition: 'before' | 'after' }>
    >()
    for (const delivery of nearby.deliveries) {
      const contexts = includedDeliveryContexts.get(delivery.id) ?? []
      contexts.push({
        unresolvedDeploymentId: delivery.unresolved_deployment_id,
        relativePosition: delivery.relative_position,
      })
      includedDeliveryContexts.set(delivery.id, contexts)
    }
    const deliveries = deliveryTarget
      ? [{ ...deliveryTarget, contexts: [] }]
      : [...new Map(nearby.deliveries.map((delivery) => [delivery.id, delivery])).values()].map(
          ({ unresolved_deployment_id, relative_position, ...delivery }) => ({
            ...delivery,
            contexts: includedDeliveryContexts.get(delivery.id) ?? [],
          }),
        )
    const [deployments, ancestryEvidence, verificationRuns, workflowRunSnapshots] = await Promise.all([
      listRepositoryCodeDeliveryExportRows(repositoryId, client, includedDeploymentIds),
      listRepositoryCodeDeliveryAncestryEvidence(
        repositoryId,
        client,
        unresolvedDeploymentIds,
        includedDeliveryIds,
        nearby.deliveries.map((delivery) => ({
          unresolvedDeploymentId: delivery.unresolved_deployment_id,
          deliveryId: delivery.id,
        })),
      ),
      listRepositoryVerificationRuns(includedDeploymentIds, client),
      listWorkflowRunSnapshots(repositoryId, includedDeploymentIds, client),
    ])
    const { prSnapshots, commitSnapshots } = await listReferencedRepositorySnapshots(verificationRuns, client)
    const repositoryAssessments = await getRepositoryAssessmentDiagnostic(
      client,
      repositoryId,
      github_repo_id,
      deliveries,
    )

    return {
      repositoryMetadata: {
        github_repo_id,
        github_owner,
        github_repo_name,
        default_branch,
        code_delivery_tracking_since,
        audit_start_year,
      },
      repositoryAliases,
      deployments,
      deliveries,
      ancestryEvidence,
      historyReadiness,
      verificationRuns,
      repositoryConfigAuditLog,
      diagnosticTargets,
      deliveryTarget: deliveryTarget ? { deliveryId: deliveryTarget.id, includedDeploymentIds } : null,
      implicitApprovalMode: repository.implicit_approval_mode,
      prSnapshots,
      commitSnapshots,
      workflowRunSnapshots,
      repositoryAssessments,
    }
  })
}

export async function getRepositoryHistoryReadiness(
  repositoryId: number,
  transactionClient?: Pick<PoolClient, 'query'>,
): Promise<RepositoryHistoryReadiness> {
  if (transactionClient) return getRepositoryHistoryReadinessFromClient(repositoryId, transactionClient)
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    return getRepositoryHistoryReadinessFromClient(repositoryId, client)
  })
}

async function getRepositoryHistoryReadinessFromClient(
  repositoryId: number,
  client: Pick<PoolClient, 'query'>,
): Promise<RepositoryHistoryReadiness> {
  const applications = await client.query<RepositoryHistoryApplicationReadiness>(
    `WITH repository_apps AS (
         SELECT DISTINCT ar.monitored_app_id
         FROM application_repositories ar
         JOIN repositories r ON r.github_repo_id = ar.github_repo_id
         WHERE r.id = $1 AND ar.status IN ('active', 'historical')
       )
       SELECT ma.team_slug, ma.environment_name, ma.app_name, ma.is_active,
              ma.initial_nais_history_synced_at,
              count(d.id)::int AS deployment_count,
              count(d.id) FILTER (WHERE d.repository_id = $1)::int AS repository_deployment_count,
              count(d.id) FILTER (WHERE d.repository_id IS NULL)::int AS unassigned_deployment_count,
              count(d.id) FILTER (WHERE d.repository_id IS NOT NULL AND d.repository_id <> $1)::int
                AS other_repository_deployment_count,
              count(d.id) FILTER (
                WHERE d.repository_id = $1 AND (d.commit_sha IS NULL OR d.commit_sha !~ '^[0-9a-fA-F]{40}$')
              )::int AS repository_deployments_missing_sha
       FROM repository_apps ra
       JOIN monitored_applications ma ON ma.id = ra.monitored_app_id
       LEFT JOIN deployments d
         ON d.monitored_app_id = ma.id
       GROUP BY ma.id
       ORDER BY ma.is_active DESC, ma.environment_name, ma.team_slug, ma.app_name`,
    [repositoryId],
  )
  const repositoryDeployments = await client.query<{
    deployment_count: number
    deployments_missing_sha: number
    deployments_without_known_app_link: number
  }>(
    `SELECT count(*)::int AS deployment_count,
              count(*) FILTER (
                WHERE d.commit_sha IS NULL OR d.commit_sha !~ '^[0-9a-fA-F]{40}$'
              )::int AS deployments_missing_sha,
              count(*) FILTER (
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM application_repositories ar
                  WHERE ar.monitored_app_id = d.monitored_app_id
                    AND ar.github_repo_id = r.github_repo_id
                    AND ar.status IN ('active', 'historical')
                )
              )::int AS deployments_without_known_app_link
       FROM deployments d
       JOIN repositories r ON r.id = d.repository_id
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       WHERE r.id = $1`,
    [repositoryId],
  )

  return {
    applications: applications.rows,
    repositoryDeploymentCount: repositoryDeployments.rows[0].deployment_count,
    repositoryDeploymentsMissingShaCount: repositoryDeployments.rows[0].deployments_missing_sha,
    repositoryDeploymentsWithoutKnownAppLinkCount: repositoryDeployments.rows[0].deployments_without_known_app_link,
  }
}

export interface UnresolvedCodeDeployment {
  deployment_id: number
  team_slug: string
  environment_name: string
  app_name: string
  commit_sha: string
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  deployed_at: Date
  reason: UnresolvedReason
  first_seen_at: Date
  last_attempt_at: Date
}

export async function getRepositoryCodeDeliveryOverview(
  repositoryId: number,
  client: Pick<PoolClient, 'query'> = pool,
): Promise<RepositoryCodeDeliveryOverview> {
  const [deliveries, linked, awaiting, unresolved] = await Promise.all([
    client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM repository_code_deliveries WHERE repository_id = $1`,
      [repositoryId],
    ),
    client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM deployments d
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       WHERE d.repository_id = $1
         AND d.repository_code_delivery_id IS NOT NULL`,
      [repositoryId],
    ),
    client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM deployments d
       JOIN repositories r ON r.id = d.repository_id
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       LEFT JOIN repository_code_delivery_unresolved u ON u.deployment_id = d.id AND u.resolved_at IS NULL
       WHERE d.repository_id = $1
         AND r.code_delivery_tracking = true
         AND r.code_delivery_tracking_since IS NOT NULL
         AND d.created_at >= r.code_delivery_tracking_since
         AND d.repository_code_delivery_id IS NULL
         AND d.commit_sha ~ '^[0-9a-fA-F]{40}$'
         AND u.deployment_id IS NULL`,
      [repositoryId],
    ),
    client.query<{ reason: UnresolvedReason; count: number }>(
      `SELECT u.reason, count(*)::int AS count
       FROM repository_code_delivery_unresolved u
       JOIN deployments d ON d.id = u.deployment_id
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       WHERE d.repository_id = $1
         AND u.resolved_at IS NULL
       GROUP BY u.reason`,
      [repositoryId],
    ),
  ])

  const unresolvedByReason: Partial<Record<UnresolvedReason, number>> = {}
  for (const row of unresolved.rows) {
    unresolvedByReason[row.reason] = row.count
  }

  return {
    deliveryCount: deliveries.rows[0].count,
    linkedDeploymentCount: linked.rows[0].count,
    awaitingDeploymentCount: awaiting.rows[0].count,
    unresolvedByReason,
  }
}

export async function listRepositoryCodeDeliveries(
  repositoryId: number,
  options: {
    limit: number | null
    offset: number
    sort?: { orderBy: RepositoryCodeDeliverySortKey; direction: RepositoryCodeDeliverySortDirection }
  },
  client: Pick<PoolClient, 'query'> = pool,
): Promise<RepositoryCodeDeliverySummary[]> {
  const sortColumns: Record<RepositoryCodeDeliverySortKey, string> = {
    first_deployed_at: 'first_deployed_at',
    created_at: 'c.created_at',
    base_sha: 'c.base_sha',
    head_sha: 'c.head_sha',
    deployment_count: 'deployment_count',
    app_names: 'app_names',
  }
  const orderBy = options.sort
    ? `${sortColumns[options.sort.orderBy]} ${options.sort.direction === 'ascending' ? 'ASC' : 'DESC'} NULLS LAST, c.id DESC`
    : 'c.id DESC'
  const { rows } = await client.query<RepositoryCodeDeliverySummary>(
    `SELECT c.id, c.base_sha, c.head_sha, c.created_at,
            min(d.created_at) AS first_deployed_at,
            lower(c.base_sha) = lower(c.head_sha) AS is_anchor,
            count(d.id)::int AS deployment_count,
            COALESCE(array_agg(DISTINCT d.app_name ORDER BY d.app_name) FILTER (WHERE d.id IS NOT NULL), '{}') AS app_names
     FROM repository_code_deliveries c
     LEFT JOIN deployments d ON d.repository_code_delivery_id = c.id
     WHERE c.repository_id = $1
     GROUP BY c.id
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET $3`,
    [repositoryId, options.limit, options.offset],
  )
  return rows
}

export async function getRepositoryCodeDeliveryEvidence(
  repositoryId: number,
  deliveryId: number,
  requestedPage = 1,
  transactionClient?: PoolClient,
): Promise<RepositoryCodeDeliveryEvidence | null> {
  const read = async (client: PoolClient): Promise<RepositoryCodeDeliveryEvidence | null> => {
    const { rows: deliveryRows } = await client.query<
      Omit<RepositoryCodeDeliveryEvidence, 'deployments' | 'page' | 'totalPages' | 'totalEvidenceEntries'>
    >(
      `SELECT c.id, c.base_sha, c.head_sha, c.created_at,
              (SELECT min(d.created_at) FROM deployments d
               WHERE d.repository_id = c.repository_id AND d.repository_code_delivery_id = c.id) AS first_deployed_at,
              jsonb_build_object(
                'status', CASE
                  WHEN sync.completed_at IS NOT NULL
                       AND sync.completed_assessment_version >= $3 THEN 'completed'
                  WHEN sync.failed_permanently THEN 'permanently_failed'
                  WHEN sync.locked_until > now() THEN 'processing'
                  WHEN NOT repository.code_delivery_tracking
                       OR repository.code_delivery_tracking_since IS NULL THEN 'tracking_disabled'
                  WHEN sync.delivery_id IS NULL THEN 'not_queued'
                  WHEN sync.completed_at IS NOT NULL
                       AND sync.completed_assessment_version < $3 THEN 'outdated'
                  WHEN sync.next_attempt_at > now() THEN 'retry_wait'
                  ELSE 'queued'
                END,
                'attempt_count', COALESCE(sync.attempt_count, 0),
                'next_attempt_at', sync.next_attempt_at,
                'locked_until', sync.locked_until,
                'completed_at', sync.completed_at,
                'completed_assessment_version', COALESCE(sync.completed_assessment_version, 0),
                'last_error', sync.last_error,
                'updated_at', sync.updated_at,
                'completed_association_snapshots',
                  (SELECT count(*)::int FROM jsonb_object_keys(sync.completed_association_snapshot_ids)),
                'completed_pull_request_snapshots',
                  (SELECT count(*)::int FROM jsonb_object_keys(sync.completed_pull_request_snapshot_ids)),
                'stack_parent_pull_requests',
                  (SELECT count(DISTINCT parent.number)::int
                   FROM jsonb_each(sync.stack_parent_pull_request_numbers) AS checked
                   CROSS JOIN LATERAL jsonb_array_elements_text(checked.value) AS parent(number))
              ) AS assessment_sync
       FROM repository_code_deliveries c
       JOIN repositories repository ON repository.id = c.repository_id
       LEFT JOIN repository_code_delivery_assessment_sync sync ON sync.delivery_id = c.id
       WHERE c.repository_id = $1 AND c.id = $2`,
      [repositoryId, deliveryId, REPOSITORY_CODE_DELIVERY_ASSESSMENT_VERSION],
    )
    const delivery = deliveryRows[0]
    if (!delivery) return null

    const { rows: countRows } = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM deployments d
      JOIN monitored_applications ma ON ma.id = d.monitored_app_id
      LEFT JOIN verification_runs vr ON vr.deployment_id = d.id
      WHERE d.repository_id = $1 AND d.repository_code_delivery_id = $2`,
      [repositoryId, deliveryId],
    )
    const totalEvidenceEntries = countRows[0].count
    const totalPages = Math.max(1, Math.ceil(totalEvidenceEntries / REPOSITORY_CODE_DELIVERY_EVIDENCE_PAGE_SIZE))
    const page = Math.min(Math.max(requestedPage, 1), totalPages)

    const { rows: evidenceRows } = await client.query<{
      deployment_id: number
      deployed_at: Date
      team_slug: string
      environment_name: string
      app_name: string
      verification_run_id: number | null
      run_at: Date | null
      schema_version: number | null
      status: string | null
      comparison_range: unknown
      pr_snapshot_ids: number[] | null
    }>(
      `SELECT d.id AS deployment_id, d.created_at AS deployed_at,
              d.team_slug, d.environment_name, d.app_name,
              vr.id AS verification_run_id, vr.run_at, vr.schema_version, vr.status,
              vr.result->'comparisonRange' AS comparison_range, vr.pr_snapshot_ids
       FROM deployments d
      JOIN monitored_applications ma ON ma.id = d.monitored_app_id
      LEFT JOIN verification_runs vr ON vr.deployment_id = d.id
      WHERE d.repository_id = $1 AND d.repository_code_delivery_id = $2
       ORDER BY d.created_at, d.id, vr.run_at, vr.id
       LIMIT $3 OFFSET $4`,
      [
        repositoryId,
        deliveryId,
        REPOSITORY_CODE_DELIVERY_EVIDENCE_PAGE_SIZE,
        (page - 1) * REPOSITORY_CODE_DELIVERY_EVIDENCE_PAGE_SIZE,
      ],
    )
    const verificationRunIds = evidenceRows.flatMap((row) =>
      row.verification_run_id === null ? [] : [row.verification_run_id],
    )
    const snapshotIds = [...new Set(evidenceRows.flatMap((row) => row.pr_snapshot_ids ?? []))]
    const { rows: snapshotRows } =
      verificationRunIds.length > 0 && snapshotIds.length > 0
        ? await client.query<{
            verification_run_id: number
            id: number
            pr_number: number
            schema_version: number
            fetched_at: Date
            source: string
            github_available: boolean
            data: unknown
          }>(
            `SELECT vr.id AS verification_run_id, snapshot.id, snapshot.pr_number,
                    snapshot.schema_version, snapshot.fetched_at, snapshot.source,
                    snapshot.github_available, snapshot.data
             FROM verification_runs vr
             CROSS JOIN LATERAL unnest(vr.pr_snapshot_ids) AS referenced(snapshot_id)
             JOIN github_pr_snapshots snapshot ON snapshot.id = referenced.snapshot_id
             WHERE vr.id = ANY($1::int[])
               AND snapshot.id = ANY($2::int[])
               AND snapshot.data_type = 'reviews'
             ORDER BY vr.id, snapshot.pr_number, snapshot.fetched_at, snapshot.id`,
            [verificationRunIds, snapshotIds],
          )
        : { rows: [] }
    const snapshotsByRunId = new Map<number, RepositoryCodeDeliveryReviewSnapshot[]>()
    for (const snapshot of snapshotRows) {
      const snapshots = snapshotsByRunId.get(snapshot.verification_run_id) ?? []
      snapshots.push({
        id: snapshot.id,
        pr_number: snapshot.pr_number,
        schema_version: snapshot.schema_version,
        fetched_at: snapshot.fetched_at,
        source: snapshot.source,
        github_available: snapshot.github_available,
        reviews: snapshot.github_available ? parseRepositoryDeliveryReviews(snapshot.data) : null,
      })
      snapshotsByRunId.set(snapshot.verification_run_id, snapshots)
    }

    const deployments = new Map<number, RepositoryCodeDeliveryDeploymentEvidence>()
    for (const row of evidenceRows) {
      let deployment = deployments.get(row.deployment_id)
      if (!deployment) {
        deployment = {
          id: row.deployment_id,
          deployed_at: row.deployed_at,
          team_slug: row.team_slug,
          environment_name: row.environment_name,
          app_name: row.app_name,
          verification_runs: [],
        }
        deployments.set(row.deployment_id, deployment)
      }
      if (row.verification_run_id !== null && row.run_at !== null && row.status !== null) {
        const comparisonRange = parseRepositoryDeliveryComparisonRange(row.comparison_range)
        deployment.verification_runs.push({
          id: row.verification_run_id,
          run_at: row.run_at,
          schema_version: row.schema_version ?? 0,
          status: row.status,
          comparison_range: comparisonRange,
          comparison_range_invalid: row.comparison_range !== null && comparisonRange === null,
          review_snapshots: snapshotsByRunId.get(row.verification_run_id) ?? [],
        })
      }
    }

    const [intervalAssessment] = await getRepositoryCodeDeliveryIntervalAssessments(repositoryId, [delivery], client)
    if (!intervalAssessment) throw new Error(`Missing interval assessment for delivery ${deliveryId}`)

    return {
      ...delivery,
      interval_assessment: intervalAssessment.assessment,
      page,
      totalPages,
      totalEvidenceEntries,
      deployments: [...deployments.values()],
    }
  }
  if (transactionClient) return read(transactionClient)
  return withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    return read(client)
  })
}

export async function listOpenUnresolvedCodeDeployments(
  repositoryId: number,
  limit: number,
  client: Pick<PoolClient, 'query'> = pool,
): Promise<UnresolvedCodeDeployment[]> {
  const { rows } = await client.query<UnresolvedCodeDeployment>(
    `SELECT d.id AS deployment_id, d.team_slug, d.environment_name, d.app_name, d.commit_sha,
            d.detected_github_owner, d.detected_github_repo_name, d.created_at AS deployed_at, u.reason, u.created_at AS first_seen_at, u.updated_at AS last_attempt_at
     FROM repository_code_delivery_unresolved u
     JOIN deployments d ON d.id = u.deployment_id
     WHERE d.repository_id = $1 AND u.resolved_at IS NULL
     ORDER BY u.updated_at DESC, d.id DESC
     LIMIT $2`,
    [repositoryId, limit],
  )
  return rows
}
