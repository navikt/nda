import type { NaisApplicationUpdatedActivity } from '~/lib/nais.server'
import { pool } from './connection.server'

export interface NaisApplyActivitySyncState {
  last_activity_created_at: Date | null
  initial_history_synced_at: Date | null
  last_synced_at: Date | null
  last_attempt_at: Date | null
  last_error: string | null
}

export async function getNaisApplyActivityEvents(
  monitoredAppId: number,
  options: { fullHistory?: boolean; sourceIds?: string[] } = {},
): Promise<NaisApplicationUpdatedActivity[]> {
  const result = await pool.query<{
    activity_log_id: string
    created_at: Date
    actor: string
    message: string
    resource_name: string
    team_slug: string
    environment_name: string | null
    github_actor_claims: NaisApplicationUpdatedActivity['gitHubActorClaims']
    changed_fields: NaisApplicationUpdatedActivity['changedFields']
  }>(
    `SELECT activity_log_id, created_at, actor, message, resource_name, team_slug,
            environment_name, github_actor_claims, changed_fields
     FROM nais_apply_activity_events
     WHERE monitored_app_id = $1
       ${
         options.sourceIds !== undefined
           ? 'AND materialization_source_ids && $2::text[]'
           : options.fullHistory
             ? ''
             : `AND (materialized_at IS NULL OR materialization_retry_at <= CURRENT_TIMESTAMP)`
       }
     ORDER BY created_at, id`,
    options.sourceIds !== undefined ? [monitoredAppId, options.sourceIds] : [monitoredAppId],
  )
  return result.rows.map((row) => ({
    id: row.activity_log_id,
    createdAt: row.created_at.toISOString(),
    actor: row.actor,
    message: row.message,
    resourceName: row.resource_name,
    teamSlug: row.team_slug,
    environmentName: row.environment_name,
    gitHubActorClaims: row.github_actor_claims,
    changedFields: row.changed_fields,
  }))
}

export async function markNaisApplyActivitiesMaterialized(
  monitoredAppId: number,
  activities: { activityLogId: string; sourceIds: string[]; retry: boolean }[],
): Promise<void> {
  if (activities.length === 0) return

  await pool.query(
    `UPDATE nais_apply_activity_events events
     SET materialized_at = CURRENT_TIMESTAMP,
         materialization_source_ids = ARRAY(SELECT jsonb_array_elements_text(entries."sourceIds")),
         materialization_retry_at = CASE WHEN entries.retry THEN CURRENT_TIMESTAMP + INTERVAL '5 minutes' END
     FROM jsonb_to_recordset($2::jsonb) AS entries("activityLogId" TEXT, "sourceIds" JSONB, retry BOOLEAN)
     WHERE events.monitored_app_id = $1 AND events.activity_log_id = entries."activityLogId"`,
    [monitoredAppId, JSON.stringify(activities)],
  )
}

export async function getNaisApplyActivitySyncState(
  monitoredAppId: number,
): Promise<NaisApplyActivitySyncState | null> {
  const result = await pool.query<NaisApplyActivitySyncState>(
    `SELECT last_activity_created_at, initial_history_synced_at, last_synced_at, last_attempt_at, last_error
     FROM nais_apply_activity_sync_state
     WHERE monitored_app_id = $1`,
    [monitoredAppId],
  )
  return result.rows[0] ?? null
}

export async function saveNaisApplyActivityEvents(
  monitoredAppId: number,
  events: NaisApplicationUpdatedActivity[],
): Promise<number> {
  if (events.length === 0) return 0

  const payload = events.map((event) => ({
    activityLogId: event.id,
    createdAt: event.createdAt,
    actor: event.actor,
    message: event.message,
    resourceName: event.resourceName,
    teamSlug: event.teamSlug,
    environmentName: event.environmentName,
    githubActorClaims: event.gitHubActorClaims,
    changedFields: event.changedFields,
  }))

  const result = await pool.query(
    `INSERT INTO nais_apply_activity_events (
       monitored_app_id, activity_log_id, created_at, actor, message, resource_name,
       team_slug, environment_name, github_actor_claims, changed_fields
     )
     SELECT
       $1,
       entries."activityLogId",
       entries."createdAt",
       entries.actor,
       entries.message,
       entries."resourceName",
       entries."teamSlug",
       entries."environmentName",
       entries."githubActorClaims",
       entries."changedFields"
     FROM jsonb_to_recordset($2::jsonb) AS entries(
       "activityLogId" TEXT,
       "createdAt" TIMESTAMPTZ,
       actor TEXT,
       message TEXT,
       "resourceName" TEXT,
       "teamSlug" TEXT,
       "environmentName" TEXT,
       "githubActorClaims" JSONB,
       "changedFields" JSONB
     )
     ON CONFLICT (monitored_app_id, activity_log_id) DO NOTHING`,
    [monitoredAppId, JSON.stringify(payload)],
  )
  return result.rowCount ?? 0
}

export async function markNaisApplyActivitySyncComplete(
  monitoredAppId: number,
  latestActivityCreatedAt: Date | null,
  initialHistoryComplete: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO nais_apply_activity_sync_state (
       monitored_app_id, last_activity_created_at, initial_history_synced_at, last_synced_at,
       last_attempt_at, last_error
     )
     VALUES ($1, $2, CASE WHEN $3 THEN CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
     ON CONFLICT (monitored_app_id) DO UPDATE SET
       last_activity_created_at = CASE
         WHEN EXCLUDED.last_activity_created_at IS NULL
           THEN nais_apply_activity_sync_state.last_activity_created_at
         WHEN nais_apply_activity_sync_state.last_activity_created_at IS NULL
           THEN EXCLUDED.last_activity_created_at
         ELSE GREATEST(
           nais_apply_activity_sync_state.last_activity_created_at,
           EXCLUDED.last_activity_created_at
         )
       END,
       initial_history_synced_at = COALESCE(
         nais_apply_activity_sync_state.initial_history_synced_at,
         EXCLUDED.initial_history_synced_at
       ),
       last_synced_at = CURRENT_TIMESTAMP,
       last_attempt_at = CURRENT_TIMESTAMP,
       last_error = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [monitoredAppId, latestActivityCreatedAt, initialHistoryComplete],
  )
}

export async function markNaisApplyActivitySyncFailure(monitoredAppId: number, error: string): Promise<void> {
  await pool.query(
    `INSERT INTO nais_apply_activity_sync_state (monitored_app_id, last_attempt_at, last_error)
     VALUES ($1, CURRENT_TIMESTAMP, $2)
     ON CONFLICT (monitored_app_id) DO UPDATE SET
       last_attempt_at = CURRENT_TIMESTAMP,
       last_error = EXCLUDED.last_error,
       updated_at = CURRENT_TIMESTAMP`,
    [monitoredAppId, error],
  )
}
