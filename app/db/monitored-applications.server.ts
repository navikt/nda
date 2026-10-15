import type { PoolClient } from 'pg'
import type { NaisHistoryRecoveryCandidate, NaisHistoryRiskApp } from '~/lib/nais-history-recovery'
import { lockMonitoredAppSync, pool, withTransaction } from './connection.server'

export interface MonitoredApplication {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  is_active: boolean
  default_branch: string | null
  default_branch_synced_at: Date | null
  test_requirement: 'none' | 'unit_tests' | 'integration_tests'
  slack_channel_id: string | null
  slack_notifications_enabled: boolean
  reminder_enabled: boolean
  reminder_time: string | null
  reminder_days: string[] | null
  reminder_last_sent_at: Date | null
  reminder_channel_id: string | null
  slack_notifications_enabled_at: Date | null
  slack_deploy_channel_id: string | null
  slack_deploy_notify_enabled: boolean
  slack_deploy_notify_enabled_at: Date | null
  nais_apply_enabled: boolean
  not_found_in_nais_at: Date | null
  initial_nais_history_synced_at: Date | null
  created_at: Date
  updated_at: Date
}

export async function getAllMonitoredApplications(): Promise<MonitoredApplication[]> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE is_active = true ORDER BY team_slug, environment_name, app_name',
  )
  return result.rows
}

export async function getNaisHistoryRecoveryCandidates(searchTerm?: string): Promise<NaisHistoryRecoveryCandidate[]> {
  const search = searchTerm?.trim()
  const searchPattern = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null
  const result = await pool.query(
    `SELECT
       ma.id,
       ma.team_slug,
       ma.environment_name,
       ma.app_name,
       ma.initial_nais_history_synced_at,
       latest.status AS latest_sync_status,
       latest.started_at AS latest_sync_started_at,
       latest.options->>'version' AS latest_sync_version,
       COALESCE(
         latest.status = 'running' AND (latest.lock_expires_at IS NULL OR latest.lock_expires_at > NOW()),
         FALSE
       ) AS latest_sync_is_active
     FROM monitored_applications ma
     LEFT JOIN LATERAL (
       SELECT status, started_at, options, lock_expires_at
       FROM sync_jobs
       WHERE monitored_app_id = ma.id AND job_type = 'nais_sync'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE ma.is_active = TRUE
       AND ma.initial_nais_history_synced_at IS NOT NULL
       AND (
         $1::text IS NULL
         OR ma.team_slug ILIKE $1 ESCAPE E'\\\\'
         OR ma.environment_name ILIKE $1 ESCAPE E'\\\\'
         OR ma.app_name ILIKE $1 ESCAPE E'\\\\'
       )
     ORDER BY ma.team_slug, ma.environment_name, ma.app_name
     LIMIT 100`,
    [searchPattern],
  )
  return result.rows
}

export async function getNaisHistoryRiskApps(): Promise<NaisHistoryRiskApp[]> {
  const result = await pool.query(
    `WITH app_state AS (
       SELECT
         ma.id AS app_id,
         ma.team_slug,
         ma.environment_name,
         ma.app_name,
         ma.initial_nais_history_synced_at,
         (SELECT COUNT(*)::integer FROM sync_jobs sj
           WHERE sj.monitored_app_id = ma.id AND sj.job_type = 'nais_sync' AND sj.status = 'completed'
         ) AS completed_syncs,
         (SELECT COUNT(*)::integer FROM sync_jobs sj
           WHERE sj.monitored_app_id = ma.id AND sj.job_type = 'nais_sync' AND sj.status = 'failed'
             AND sj.started_at > COALESCE((
               SELECT MAX(c.started_at) FROM sync_jobs c
               WHERE c.monitored_app_id = ma.id AND c.job_type = 'nais_sync' AND c.status = 'completed'
             ), '-infinity')
         ) AS failed_since_last_completed,
         (SELECT MAX(c.completed_at) FROM sync_jobs c
           WHERE c.monitored_app_id = ma.id AND c.job_type = 'nais_sync' AND c.status = 'completed'
         ) AS last_completed_at,
         (SELECT sj.error FROM sync_jobs sj
           WHERE sj.monitored_app_id = ma.id AND sj.job_type = 'nais_sync' AND sj.status = 'failed'
           ORDER BY sj.started_at DESC LIMIT 1
         ) AS last_error,
         EXISTS (
           SELECT 1 FROM sync_jobs sj
           WHERE sj.monitored_app_id = ma.id AND sj.job_type = 'nais_sync' AND sj.status = 'failed'
             AND (
               sj.error ILIKE '%different monitored application%'
               OR sj.error ILIKE '%belongs to monitored application%'
               OR sj.error ILIKE '%could not be inserted or found for monitored application%'
             )
             AND (ma.initial_nais_history_synced_at IS NULL OR sj.started_at > ma.initial_nais_history_synced_at)
         ) AS id_collision,
         (
           ma.initial_nais_history_synced_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM sync_jobs o
             WHERE o.monitored_app_id = ma.id AND o.job_type = 'nais_sync'
               AND o.started_at <= ma.initial_nais_history_synced_at
           )
           AND NOT EXISTS (
             SELECT 1 FROM sync_jobs c
             WHERE c.monitored_app_id = ma.id AND c.job_type = 'nais_sync' AND c.status = 'completed'
               AND ma.initial_nais_history_synced_at BETWEEN c.started_at AND c.completed_at + INTERVAL '1 minute'
           )
         ) AS marker_without_completed_job,
         (SELECT COUNT(*)::integer FROM deployments d WHERE d.monitored_app_id = ma.id) AS deployment_count
       FROM monitored_applications ma
       WHERE ma.is_active = TRUE
     )
     SELECT *
     FROM app_state
     WHERE marker_without_completed_job
        OR id_collision
        OR failed_since_last_completed > 0
        OR initial_nais_history_synced_at IS NULL
        OR deployment_count = 0
     ORDER BY team_slug, environment_name, app_name
     LIMIT 500`,
  )
  return result.rows
}

export async function resetNaisHistorySyncMarker(
  monitoredAppId: number,
): Promise<'reset' | 'already_pending' | 'sync_running' | 'not_found'> {
  return withTransaction(async (client) => {
    await lockMonitoredAppSync(client, monitoredAppId)

    await client.query(
      `UPDATE sync_jobs
       SET status = 'failed',
           error = 'Lock timeout - automatically released',
           completed_at = NOW()
       WHERE monitored_app_id = $1
         AND job_type = 'nais_sync'
         AND status = 'running'
         AND lock_expires_at <= NOW()`,
      [monitoredAppId],
    )

    const result = await client.query(
      `UPDATE monitored_applications ma
       SET initial_nais_history_synced_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE ma.id = $1
         AND ma.is_active = TRUE
         AND ma.initial_nais_history_synced_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM sync_jobs sj
           WHERE sj.monitored_app_id = ma.id
             AND sj.job_type = 'nais_sync'
             AND sj.status = 'running'
         )
       RETURNING ma.id`,
      [monitoredAppId],
    )

    if (result.rowCount === 1) return 'reset'

    const current = await client.query(
      `SELECT ma.is_active,
              EXISTS (
                SELECT 1
                FROM sync_jobs sj
                WHERE sj.monitored_app_id = ma.id
                  AND sj.job_type = 'nais_sync'
                  AND sj.status = 'running'
              ) AS sync_running
       FROM monitored_applications ma
       WHERE ma.id = $1`,
      [monitoredAppId],
    )
    const row = current.rows[0]
    if (!row?.is_active) return 'not_found'
    if (row.sync_running) return 'sync_running'
    return 'already_pending'
  })
}

export async function getAllAlertCounts(): Promise<Map<number, number>> {
  const result = await pool.query(`
    SELECT ra.monitored_app_id, COUNT(*)::integer as count
    FROM repository_alerts ra
    JOIN deployments d ON d.id = ra.deployment_id
    JOIN monitored_applications ma ON ma.id = d.monitored_app_id
    WHERE ra.resolved_at IS NULL
      AND (d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)
    GROUP BY ra.monitored_app_id
  `)
  const map = new Map<number, number>()
  for (const row of result.rows) {
    map.set(row.monitored_app_id, row.count)
  }
  return map
}

export async function getApplicationsByTeam(teamSlug: string): Promise<MonitoredApplication[]> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE team_slug = $1 AND is_active = true ORDER BY environment_name, app_name',
    [teamSlug],
  )
  return result.rows
}

export async function getApplicationsByTeamAndEnv(
  teamSlug: string,
  environmentName: string,
): Promise<MonitoredApplication[]> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE team_slug = $1 AND environment_name = $2 AND is_active = true ORDER BY app_name',
    [teamSlug, environmentName],
  )
  return result.rows
}

export async function getMonitoredApplicationById(
  id: number,
  client?: PoolClient,
): Promise<MonitoredApplication | null> {
  const queryable = client ?? pool
  const result = await queryable.query('SELECT * FROM monitored_applications WHERE id = $1', [id])
  return result.rows[0] || null
}

export async function getMonitoredApplicationByIdentity(
  teamSlug: string,
  environmentName: string,
  appName: string,
): Promise<MonitoredApplication | null> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE team_slug = $1 AND environment_name = $2 AND app_name = $3',
    [teamSlug, environmentName, appName],
  )
  return result.rows[0] || null
}

export async function markInitialNaisHistorySynced(monitoredAppId: number, syncJobId: number): Promise<boolean> {
  return withTransaction(async (client) => {
    await lockMonitoredAppSync(client, monitoredAppId)

    const result = await client.query(
      `UPDATE monitored_applications ma
       SET initial_nais_history_synced_at = COALESCE(ma.initial_nais_history_synced_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE ma.id = $1
         AND EXISTS (
           SELECT 1
           FROM sync_jobs sj
           WHERE sj.id = $2
             AND sj.monitored_app_id = ma.id
             AND sj.job_type = 'nais_sync'
             AND sj.status = 'running'
             AND sj.lock_expires_at > clock_timestamp()
         )
       RETURNING ma.id`,
      [monitoredAppId, syncJobId],
    )

    if (result.rowCount === 1) return true

    const application = await client.query('SELECT 1 FROM monitored_applications WHERE id = $1', [monitoredAppId])
    if (application.rowCount === 0) {
      throw new Error(`Monitored application not found: ${monitoredAppId}`)
    }
    return false
  })
}

export async function createMonitoredApplication(
  data: {
    team_slug: string
    environment_name: string
    app_name: string
    default_branch?: string | null
  },
  client?: PoolClient,
): Promise<MonitoredApplication> {
  const queryable = client ?? pool
  const result = await queryable.query(
    `INSERT INTO monitored_applications
        (team_slug, environment_name, app_name, default_branch)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (team_slug, environment_name, app_name)
      DO UPDATE SET
        is_active = true,
        not_found_in_nais_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
    [data.team_slug, data.environment_name, data.app_name, data.default_branch ?? null],
  )
  return result.rows[0]
}

export async function updateMonitoredApplication(
  id: number,
  data: {
    is_active?: boolean
    default_branch?: string
    default_branch_synced_at?: Date | null
    test_requirement?: 'none' | 'unit_tests' | 'integration_tests'
    slack_channel_id?: string | null
    slack_notifications_enabled?: boolean
    slack_deploy_channel_id?: string | null
    slack_deploy_notify_enabled?: boolean
    nais_apply_enabled?: boolean
    reminder_enabled?: boolean
    reminder_time?: string
    reminder_days?: string[]
    reminder_channel_id?: string | null
    not_found_in_nais_at?: Date | null
  },
  client?: PoolClient,
): Promise<MonitoredApplication> {
  const queryable = client ?? pool
  const updates: string[] = []
  const values: any[] = []
  let paramCount = 1

  if (data.is_active !== undefined) {
    updates.push(`is_active = $${paramCount++}`)
    values.push(data.is_active)
  }

  if (data.default_branch !== undefined) {
    updates.push(`default_branch = $${paramCount++}`)
    values.push(data.default_branch)
  }

  if (data.default_branch_synced_at !== undefined) {
    updates.push(`default_branch_synced_at = $${paramCount++}`)
    values.push(data.default_branch_synced_at)
  }

  if (data.test_requirement !== undefined) {
    updates.push(`test_requirement = $${paramCount++}`)
    values.push(data.test_requirement)
  }

  if (data.slack_channel_id !== undefined) {
    updates.push(`slack_channel_id = $${paramCount++}`)
    values.push(data.slack_channel_id)
  }

  if (data.slack_notifications_enabled !== undefined) {
    updates.push(`slack_notifications_enabled = $${paramCount++}`)
    values.push(data.slack_notifications_enabled)
    if (data.slack_notifications_enabled) {
      updates.push(`slack_notifications_enabled_at = COALESCE(slack_notifications_enabled_at, CURRENT_TIMESTAMP)`)
    } else {
      updates.push(`slack_notifications_enabled_at = NULL`)
    }
  }

  if (data.slack_deploy_channel_id !== undefined) {
    updates.push(`slack_deploy_channel_id = $${paramCount++}`)
    values.push(data.slack_deploy_channel_id)
  }

  if (data.slack_deploy_notify_enabled !== undefined) {
    updates.push(`slack_deploy_notify_enabled = $${paramCount++}`)
    values.push(data.slack_deploy_notify_enabled)
    if (data.slack_deploy_notify_enabled) {
      updates.push(`slack_deploy_notify_enabled_at = COALESCE(slack_deploy_notify_enabled_at, CURRENT_TIMESTAMP)`)
    } else {
      updates.push(`slack_deploy_notify_enabled_at = NULL`)
    }
  }

  if (data.nais_apply_enabled !== undefined) {
    updates.push(`nais_apply_enabled = $${paramCount++}`)
    values.push(data.nais_apply_enabled)
  }

  if (data.reminder_enabled !== undefined) {
    updates.push(`reminder_enabled = $${paramCount++}`)
    values.push(data.reminder_enabled)
  }

  if (data.reminder_time !== undefined) {
    updates.push(`reminder_time = $${paramCount++}`)
    values.push(data.reminder_time)
  }

  if (data.reminder_days !== undefined) {
    updates.push(`reminder_days = $${paramCount++}`)
    values.push(data.reminder_days)
  }

  if (data.reminder_channel_id !== undefined) {
    updates.push(`reminder_channel_id = $${paramCount++}`)
    values.push(data.reminder_channel_id)
  }

  if (data.not_found_in_nais_at !== undefined) {
    updates.push(`not_found_in_nais_at = $${paramCount++}`)
    values.push(data.not_found_in_nais_at)
  }

  if (updates.length === 0) {
    throw new Error('No fields to update')
  }

  values.push(id)
  const result = await queryable.query(
    `UPDATE monitored_applications SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`,
    values,
  )

  if (result.rows.length === 0) {
    throw new Error('Application not found')
  }

  return result.rows[0]
}

export async function updateMonitoredApplicationIdentity(
  id: number,
  identity: { team_slug: string; environment_name: string; app_name: string },
): Promise<MonitoredApplication> {
  const conflict = await pool.query(
    'SELECT id FROM monitored_applications WHERE team_slug = $1 AND environment_name = $2 AND app_name = $3 AND id <> $4',
    [identity.team_slug, identity.environment_name, identity.app_name, id],
  )
  if (conflict.rows.length > 0) {
    throw new Error(
      `En annen rad (id ${conflict.rows[0].id}) bruker allerede ${identity.team_slug}/${identity.environment_name}/${identity.app_name}. Deaktiver den først.`,
    )
  }

  const result = await pool.query(
    `UPDATE monitored_applications
     SET team_slug = $1, environment_name = $2, app_name = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING *`,
    [identity.team_slug, identity.environment_name, identity.app_name, id],
  )
  if (result.rows.length === 0) {
    throw new Error('Application not found')
  }
  return result.rows[0]
}
