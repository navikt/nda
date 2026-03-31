import { logger } from '~/lib/logger.server'
import type { ImplicitApprovalMode } from '~/lib/verification/types'
import { pool } from './connection.server'

// ============================================================================
// Types
// ============================================================================

interface AppSetting {
  id: number
  monitored_app_id: number
  setting_key: string
  setting_value: Record<string, unknown>
  updated_at: Date
}

interface AppConfigAuditLogEntry {
  id: number
  monitored_app_id: number
  changed_by_nav_ident: string
  changed_by_name: string | null
  setting_key: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown>
  change_reason: string | null
  created_at: Date
}

// Implicit approval settings structure
export interface ImplicitApprovalSettings {
  mode: ImplicitApprovalMode
  [key: string]: unknown // Allow index signature for Record<string, unknown> compatibility
}

export const DEFAULT_IMPLICIT_APPROVAL_SETTINGS: ImplicitApprovalSettings = {
  mode: 'off',
}

// Setting keys
const SETTING_KEYS = {
  IMPLICIT_APPROVAL: 'implicit_approval',
} as const

// Re-export for convenience
export type { ImplicitApprovalMode }

// ============================================================================
// Settings CRUD
// ============================================================================

/**
 * Get a setting for an application
 */
async function getAppSetting<T extends Record<string, unknown>>(
  monitoredAppId: number,
  settingKey: string,
  defaultValue: T,
): Promise<T> {
  const result = await pool.query<AppSetting>(
    'SELECT * FROM app_settings WHERE monitored_app_id = $1 AND setting_key = $2',
    [monitoredAppId, settingKey],
  )

  if (result.rows.length === 0) {
    return defaultValue
  }

  return { ...defaultValue, ...result.rows[0].setting_value } as T
}

/**
 * Get implicit approval settings for an application
 */
export async function getImplicitApprovalSettings(monitoredAppId: number): Promise<ImplicitApprovalSettings> {
  return getAppSetting(monitoredAppId, SETTING_KEYS.IMPLICIT_APPROVAL, DEFAULT_IMPLICIT_APPROVAL_SETTINGS)
}

/**
 * Update a setting for an application with audit logging
 */
async function updateAppSetting<T extends Record<string, unknown>>(params: {
  monitoredAppId: number
  settingKey: string
  newValue: T
  changedByNavIdent: string
  changedByName?: string
  changeReason?: string
}): Promise<AppSetting> {
  const { monitoredAppId, settingKey, newValue, changedByNavIdent, changedByName, changeReason } = params

  // Get current value for audit log
  const currentResult = await pool.query<AppSetting>(
    'SELECT * FROM app_settings WHERE monitored_app_id = $1 AND setting_key = $2',
    [monitoredAppId, settingKey],
  )
  const oldValue = currentResult.rows[0]?.setting_value || null

  // Upsert the setting
  const settingResult = await pool.query<AppSetting>(
    `INSERT INTO app_settings (monitored_app_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (monitored_app_id, setting_key) 
     DO UPDATE SET setting_value = $3, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [monitoredAppId, settingKey, JSON.stringify(newValue)],
  )

  // Create audit log entry
  await pool.query(
    `INSERT INTO app_config_audit_log 
     (monitored_app_id, changed_by_nav_ident, changed_by_name, setting_key, old_value, new_value, change_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      monitoredAppId,
      changedByNavIdent,
      changedByName || null,
      settingKey,
      oldValue ? JSON.stringify(oldValue) : null,
      JSON.stringify(newValue),
      changeReason || null,
    ],
  )

  logger.info(
    `📝 Setting '${settingKey}' updated for app ${monitoredAppId} by ${changedByNavIdent}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`,
  )

  return settingResult.rows[0]
}

/**
 * Update implicit approval settings with audit logging
 */
export async function updateImplicitApprovalSettings(params: {
  monitoredAppId: number
  settings: ImplicitApprovalSettings
  changedByNavIdent: string
  changedByName?: string
  changeReason?: string
}): Promise<AppSetting> {
  return updateAppSetting({
    monitoredAppId: params.monitoredAppId,
    settingKey: SETTING_KEYS.IMPLICIT_APPROVAL,
    newValue: params.settings,
    changedByNavIdent: params.changedByNavIdent,
    changedByName: params.changedByName,
    changeReason: params.changeReason,
  })
}

// ============================================================================
// Audit Log Queries
// ============================================================================

/**
 * Get audit log entries for an application
 */
export async function getAppConfigAuditLog(
  monitoredAppId: number,
  options?: {
    settingKey?: string
    limit?: number
    offset?: number
  },
): Promise<AppConfigAuditLogEntry[]> {
  let query = 'SELECT * FROM app_config_audit_log WHERE monitored_app_id = $1'
  const params: (number | string)[] = [monitoredAppId]
  let paramIndex = 2

  if (options?.settingKey) {
    query += ` AND setting_key = $${paramIndex++}`
    params.push(options.settingKey)
  }

  query += ' ORDER BY created_at DESC'

  if (options?.limit) {
    query += ` LIMIT $${paramIndex++}`
    params.push(options.limit)
  }

  if (options?.offset) {
    query += ` OFFSET $${paramIndex++}`
    params.push(options.offset)
  }

  const result = await pool.query<AppConfigAuditLogEntry>(query, params)
  return result.rows
}

/**
 * Get audit log entries for a time period (for audit reports)
 */
async function _getAppConfigAuditLogForPeriod(
  monitoredAppId: number,
  startDate: Date,
  endDate: Date,
): Promise<AppConfigAuditLogEntry[]> {
  const result = await pool.query<AppConfigAuditLogEntry>(
    `SELECT * FROM app_config_audit_log 
     WHERE monitored_app_id = $1 AND created_at >= $2 AND created_at <= $3
     ORDER BY created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )
  return result.rows
}

/**
 * Get all settings for an application
 */
async function _getAllAppSettings(monitoredAppId: number): Promise<AppSetting[]> {
  const result = await pool.query<AppSetting>(
    'SELECT * FROM app_settings WHERE monitored_app_id = $1 ORDER BY setting_key',
    [monitoredAppId],
  )
  return result.rows
}

// checkImplicitApproval has been consolidated into app/lib/verification/verify.ts
// Import from there if needed: import { checkImplicitApproval } from '~/lib/verification/verify'
