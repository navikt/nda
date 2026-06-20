import { logger } from '~/lib/logger.server'
import type { ImplicitApprovalMode } from '~/lib/verification/types'
import { pool } from './connection.server'

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

export interface ImplicitApprovalSettings {
  mode: ImplicitApprovalMode
  [key: string]: unknown
}

export const DEFAULT_IMPLICIT_APPROVAL_SETTINGS: ImplicitApprovalSettings = {
  mode: 'off',
}

const SETTING_KEYS = {
  IMPLICIT_APPROVAL: 'implicit_approval',
} as const

export type { ImplicitApprovalMode }

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

export async function getImplicitApprovalSettings(monitoredAppId: number): Promise<ImplicitApprovalSettings> {
  return getAppSetting(monitoredAppId, SETTING_KEYS.IMPLICIT_APPROVAL, DEFAULT_IMPLICIT_APPROVAL_SETTINGS)
}

async function updateAppSetting<T extends Record<string, unknown>>(params: {
  monitoredAppId: number
  settingKey: string
  newValue: T
  changedByNavIdent: string
  changedByName?: string
  changeReason?: string
}): Promise<AppSetting> {
  const { monitoredAppId, settingKey, newValue, changedByNavIdent, changedByName, changeReason } = params

  const currentResult = await pool.query<AppSetting>(
    'SELECT * FROM app_settings WHERE monitored_app_id = $1 AND setting_key = $2',
    [monitoredAppId, settingKey],
  )
  const oldValue = currentResult.rows[0]?.setting_value || null

  const settingResult = await pool.query<AppSetting>(
    `INSERT INTO app_settings (monitored_app_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (monitored_app_id, setting_key) 
     DO UPDATE SET setting_value = $3, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [monitoredAppId, settingKey, JSON.stringify(newValue)],
  )

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

async function _getAllAppSettings(monitoredAppId: number): Promise<AppSetting[]> {
  const result = await pool.query<AppSetting>(
    'SELECT * FROM app_settings WHERE monitored_app_id = $1 ORDER BY setting_key',
    [monitoredAppId],
  )
  return result.rows
}
