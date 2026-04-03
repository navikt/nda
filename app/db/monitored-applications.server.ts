import { pool } from './connection.server'

interface MonitoredApplication {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  is_active: boolean
  default_branch: string
  audit_start_year: number | null
  test_requirement: 'none' | 'unit_tests' | 'integration_tests'
  slack_channel_id: string | null
  slack_notifications_enabled: boolean
  reminder_enabled: boolean
  reminder_time: string | null
  reminder_days: string[] | null
  reminder_last_sent_at: Date | null
  slack_notifications_enabled_at: Date | null
  slack_deploy_channel_id: string | null
  slack_deploy_notify_enabled: boolean
  slack_deploy_notify_enabled_at: Date | null
  application_group_id: number | null
  created_at: Date
  updated_at: Date
}

export async function getAllMonitoredApplications(): Promise<MonitoredApplication[]> {
  const result = await pool.query(
    'SELECT * FROM monitored_applications WHERE is_active = true ORDER BY team_slug, environment_name, app_name',
  )
  return result.rows
}

/**
 * Get unresolved alert counts for all apps in a single query
 */
export async function getAllAlertCounts(): Promise<Map<number, number>> {
  const result = await pool.query(`
    SELECT monitored_app_id, COUNT(*)::integer as count
    FROM repository_alerts
    WHERE resolved_at IS NULL
    GROUP BY monitored_app_id
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

export async function getMonitoredApplicationById(id: number): Promise<MonitoredApplication | null> {
  const result = await pool.query('SELECT * FROM monitored_applications WHERE id = $1', [id])
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

export async function createMonitoredApplication(data: {
  team_slug: string
  environment_name: string
  app_name: string
}): Promise<MonitoredApplication> {
  const result = await pool.query(
    `INSERT INTO monitored_applications 
      (team_slug, environment_name, app_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (team_slug, environment_name, app_name) 
    DO UPDATE SET 
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [data.team_slug, data.environment_name, data.app_name],
  )
  return result.rows[0]
}

export async function updateMonitoredApplication(
  id: number,
  data: {
    is_active?: boolean
    default_branch?: string
    audit_start_year?: number | null
    test_requirement?: 'none' | 'unit_tests' | 'integration_tests'
    slack_channel_id?: string | null
    slack_notifications_enabled?: boolean
    slack_deploy_channel_id?: string | null
    slack_deploy_notify_enabled?: boolean
    reminder_enabled?: boolean
    reminder_time?: string
    reminder_days?: string[]
  },
): Promise<MonitoredApplication> {
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

  if (data.audit_start_year !== undefined) {
    updates.push(`audit_start_year = $${paramCount++}`)
    values.push(data.audit_start_year)
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

  if (updates.length === 0) {
    throw new Error('No fields to update')
  }

  values.push(id)
  const result = await pool.query(
    `UPDATE monitored_applications SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`,
    values,
  )

  if (result.rows.length === 0) {
    throw new Error('Application not found')
  }

  return result.rows[0]
}
