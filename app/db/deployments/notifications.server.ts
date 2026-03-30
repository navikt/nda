import { NOT_APPROVED_STATUSES, PENDING_STATUSES } from '~/lib/four-eyes-status'
import { pool } from '../connection.server'
import type { AppReminderConfig, DeploymentWithApp } from '../deployments.server'
import { getDeploymentById } from '../deployments.server'

/**
 * Atomically claim a deployment for Slack notification.
 * Returns the deployment only if this call successfully claimed it (no prior slack_message_ts).
 * This ensures only one pod sends the notification even with multiple replicas.
 */
export async function claimDeploymentForSlackNotification(
  deploymentId: number,
  channelId: string,
  messageTs: string,
): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `UPDATE deployments 
     SET slack_message_ts = $1, slack_channel_id = $2
     WHERE id = $3 AND slack_message_ts IS NULL
     RETURNING *`,
    [messageTs, channelId, deploymentId],
  )

  if (result.rows.length === 0) {
    return null // Already claimed by another pod
  }

  // Get the full deployment with app info
  return getDeploymentById(deploymentId)
}

/**
 * Get deployments that need Slack notification (no slack_message_ts set)
 * for apps that have Slack notifications enabled
 */
async function getDeploymentsNeedingSlackNotification(limit = 50): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT d.*, 
            ma.team_slug, ma.environment_name, ma.app_name, ma.default_branch,
            ma.slack_channel_id as app_slack_channel_id,
            ma.slack_notifications_enabled
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.slack_message_ts IS NULL
       AND ma.slack_notifications_enabled = true
       AND ma.slack_channel_id IS NOT NULL
       AND ma.slack_notifications_enabled_at IS NOT NULL
       AND d.created_at >= ma.slack_notifications_enabled_at
       AND d.created_at > NOW() - INTERVAL '7 days'
     ORDER BY d.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Atomically claim a deployment for deploy notification.
 * Returns the deployment only if this call successfully claimed it (no prior slack_deploy_message_ts).
 * This ensures only one pod sends the notification even with multiple replicas.
 */
export async function claimDeploymentForDeployNotify(
  deploymentId: number,
  _channelId: string,
  messageTs: string,
): Promise<DeploymentWithApp | null> {
  const result = await pool.query(
    `UPDATE deployments 
     SET slack_deploy_message_ts = $1
     WHERE id = $2 AND slack_deploy_message_ts IS NULL
     RETURNING *`,
    [messageTs, deploymentId],
  )

  if (result.rows.length === 0) {
    return null // Already claimed by another pod
  }

  return getDeploymentById(deploymentId)
}

/**
 * Get deployments that need deploy notification (no slack_deploy_message_ts set)
 * for apps that have deploy notifications enabled.
 * Only includes deployments that have been verified (four_eyes_status != 'pending').
 */
export async function getDeploymentsNeedingDeployNotify(limit = 50): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT d.*, 
            ma.team_slug, ma.environment_name, ma.app_name, ma.default_branch,
            ma.slack_deploy_channel_id,
            ma.slack_deploy_notify_enabled
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.slack_deploy_message_ts IS NULL
       AND ma.slack_deploy_notify_enabled = true
       AND ma.slack_deploy_channel_id IS NOT NULL
       AND ma.slack_deploy_notify_enabled_at IS NOT NULL
       AND d.created_at >= ma.slack_deploy_notify_enabled_at
       AND d.four_eyes_status NOT IN ('pending', 'unknown')
       AND d.created_at > NOW() - INTERVAL '7 days'
     ORDER BY d.created_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Get all apps with reminders enabled and Slack configured
 */
export async function getAppsWithRemindersEnabled(): Promise<AppReminderConfig[]> {
  const result = await pool.query<AppReminderConfig>(
    `SELECT id, team_slug, environment_name, app_name, slack_channel_id,
            reminder_time, reminder_days, reminder_last_sent_at
     FROM monitored_applications
     WHERE reminder_enabled = true
       AND slack_notifications_enabled = true
       AND slack_channel_id IS NOT NULL
       AND is_active = true`,
  )
  return result.rows
}

/**
 * Get unapproved deployments for a specific app (for reminders)
 */
export async function getUnapprovedDeployments(monitoredAppId: number): Promise<DeploymentWithApp[]> {
  const result = await pool.query(
    `SELECT d.*,
            ma.team_slug, ma.environment_name, ma.app_name, ma.default_branch
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.monitored_app_id = $1
       AND d.four_eyes_status = ANY($2)
     ORDER BY d.created_at DESC`,
    [monitoredAppId, [...NOT_APPROVED_STATUSES, ...PENDING_STATUSES]],
  )
  return result.rows
}

/**
 * Atomically update reminder_last_sent_at (returns true if claimed)
 */
export async function claimReminderSend(appId: number, minIntervalHours: number): Promise<boolean> {
  const result = await pool.query(
    `UPDATE monitored_applications
     SET reminder_last_sent_at = NOW()
     WHERE id = $1
       AND (reminder_last_sent_at IS NULL OR reminder_last_sent_at < NOW() - INTERVAL '1 hour' * $2)
     RETURNING id`,
    [appId, minIntervalHours],
  )
  return result.rowCount !== null && result.rowCount > 0
}
