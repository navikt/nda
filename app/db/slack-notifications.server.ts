/**
 * Slack notification history database functions
 * Stores and retrieves Slack message history, updates, and interactions
 */

import { pool } from './connection.server'

// Types
interface SlackNotification {
  id: number
  deployment_id: number | null
  channel_id: string
  message_ts: string
  message_blocks: Record<string, unknown>[]
  message_text: string | null
  sent_at: Date
  updated_at: Date | null
  sent_by: string | null
}

interface SlackNotificationUpdate {
  id: number
  notification_id: number
  action: 'sent' | 'updated' | 'deleted'
  old_blocks: Record<string, unknown>[] | null
  new_blocks: Record<string, unknown>[] | null
  triggered_by: string | null
  created_at: Date
}

interface SlackInteraction {
  id: number
  notification_id: number
  action_id: string
  slack_user_id: string
  slack_username: string | null
  action_value: Record<string, unknown> | null
  created_at: Date
}

/**
 * Create a new Slack notification record
 */
export async function createSlackNotification(data: {
  deploymentId: number
  channelId: string
  messageTs: string
  messageBlocks: Record<string, unknown>[]
  messageText?: string
  sentBy?: string
}): Promise<SlackNotification> {
  const result = await pool.query(
    `INSERT INTO slack_notifications 
     (deployment_id, channel_id, message_ts, message_blocks, message_text, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.deploymentId,
      data.channelId,
      data.messageTs,
      JSON.stringify(data.messageBlocks),
      data.messageText,
      data.sentBy,
    ],
  )

  // Also log the 'sent' action
  await pool.query(
    `INSERT INTO slack_notification_updates 
     (notification_id, action, new_blocks, triggered_by)
     VALUES ($1, 'sent', $2, $3)`,
    [result.rows[0].id, JSON.stringify(data.messageBlocks), data.sentBy],
  )

  return result.rows[0]
}

/**
 * Get notification by deployment ID
 */
async function getSlackNotificationByDeployment(deploymentId: number): Promise<SlackNotification | null> {
  const result = await pool.query('SELECT * FROM slack_notifications WHERE deployment_id = $1', [deploymentId])
  return result.rows[0] || null
}

/**
 * Get notification by channel and message timestamp
 */
export async function getSlackNotificationByMessage(
  channelId: string,
  messageTs: string,
): Promise<SlackNotification | null> {
  const result = await pool.query('SELECT * FROM slack_notifications WHERE channel_id = $1 AND message_ts = $2', [
    channelId,
    messageTs,
  ])
  return result.rows[0] || null
}

/**
 * Update notification content and log the change
 */
export async function updateSlackNotification(
  notificationId: number,
  data: {
    messageBlocks: Record<string, unknown>[]
    messageText?: string
    triggeredBy?: string
  },
): Promise<SlackNotification> {
  // Get current state for audit log
  const current = await pool.query('SELECT message_blocks FROM slack_notifications WHERE id = $1', [notificationId])
  const oldBlocks = current.rows[0]?.message_blocks

  // Update the notification
  const result = await pool.query(
    `UPDATE slack_notifications 
     SET message_blocks = $1, message_text = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [JSON.stringify(data.messageBlocks), data.messageText, notificationId],
  )

  // Log the update
  await pool.query(
    `INSERT INTO slack_notification_updates 
     (notification_id, action, old_blocks, new_blocks, triggered_by)
     VALUES ($1, 'updated', $2, $3, $4)`,
    [notificationId, JSON.stringify(oldBlocks), JSON.stringify(data.messageBlocks), data.triggeredBy],
  )

  return result.rows[0]
}

/**
 * Log a message deletion
 */
async function logSlackNotificationDeleted(notificationId: number, triggeredBy?: string): Promise<void> {
  const current = await pool.query('SELECT message_blocks FROM slack_notifications WHERE id = $1', [notificationId])
  const oldBlocks = current.rows[0]?.message_blocks

  await pool.query(
    `INSERT INTO slack_notification_updates 
     (notification_id, action, old_blocks, triggered_by)
     VALUES ($1, 'deleted', $2, $3)`,
    [notificationId, JSON.stringify(oldBlocks), triggeredBy],
  )
}

/**
 * Log a Slack interaction (button click etc)
 */
export async function logSlackInteraction(data: {
  notificationId: number
  actionId: string
  slackUserId: string
  slackUsername?: string
  actionValue?: Record<string, unknown>
}): Promise<SlackInteraction> {
  const result = await pool.query(
    `INSERT INTO slack_interactions 
     (notification_id, action_id, slack_user_id, slack_username, action_value)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.notificationId, data.actionId, data.slackUserId, data.slackUsername, JSON.stringify(data.actionValue)],
  )
  return result.rows[0]
}

/**
 * Get all updates for a notification
 */
export async function getSlackNotificationUpdates(notificationId: number): Promise<SlackNotificationUpdate[]> {
  const result = await pool.query(
    'SELECT * FROM slack_notification_updates WHERE notification_id = $1 ORDER BY created_at ASC',
    [notificationId],
  )
  return result.rows
}

/**
 * Get all interactions for a notification
 */
export async function getSlackInteractions(notificationId: number): Promise<SlackInteraction[]> {
  const result = await pool.query(
    'SELECT * FROM slack_interactions WHERE notification_id = $1 ORDER BY created_at ASC',
    [notificationId],
  )
  return result.rows
}

/**
 * Get recent notifications with optional filters
 */
async function getRecentSlackNotifications(options?: {
  limit?: number
  deploymentId?: number
}): Promise<SlackNotification[]> {
  const limit = options?.limit || 50

  if (options?.deploymentId) {
    const result = await pool.query(
      'SELECT * FROM slack_notifications WHERE deployment_id = $1 ORDER BY sent_at DESC LIMIT $2',
      [options.deploymentId, limit],
    )
    return result.rows
  }

  const result = await pool.query('SELECT * FROM slack_notifications ORDER BY sent_at DESC LIMIT $1', [limit])
  return result.rows
}

/**
 * Get Slack notifications for an application (via deployments)
 */
export async function getSlackNotificationsByApp(
  appId: number,
  limit = 50,
): Promise<
  (SlackNotification & {
    deployment_commit_sha: string | null
    deployment_created_at: Date | null
    update_count: number
    interaction_count: number
  })[]
> {
  const result = await pool.query(
    `SELECT 
       sn.*,
       d.commit_sha as deployment_commit_sha,
       d.created_at as deployment_created_at,
       (SELECT COUNT(*) FROM slack_notification_updates WHERE notification_id = sn.id) as update_count,
       (SELECT COUNT(*) FROM slack_interactions WHERE notification_id = sn.id) as interaction_count
     FROM slack_notifications sn
     JOIN deployments d ON d.id = sn.deployment_id
     WHERE d.monitored_app_id = $1
     ORDER BY sn.sent_at DESC
     LIMIT $2`,
    [appId, limit],
  )
  return result.rows
}
