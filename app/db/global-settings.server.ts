import { pool } from './connection.server'

interface GlobalSetting {
  id: number
  setting_key: string
  setting_value: Record<string, unknown>
  updated_at: Date
}

const GLOBAL_SETTING_KEYS = {
  DEVIATION_SLACK_CHANNEL: 'deviation_slack_channel',
} as const

interface DeviationSlackChannelSettings {
  channel_id: string
  [key: string]: unknown
}

const DEFAULT_DEVIATION_SLACK_CHANNEL: DeviationSlackChannelSettings = {
  channel_id: '',
}

async function getGlobalSetting<T extends Record<string, unknown>>(settingKey: string, defaultValue: T): Promise<T> {
  const result = await pool.query<GlobalSetting>('SELECT * FROM global_settings WHERE setting_key = $1', [settingKey])
  if (result.rows.length === 0) {
    return defaultValue
  }
  return { ...defaultValue, ...result.rows[0].setting_value } as T
}

async function updateGlobalSetting<T extends Record<string, unknown>>(params: {
  settingKey: string
  newValue: T
}): Promise<GlobalSetting> {
  const result = await pool.query<GlobalSetting>(
    `INSERT INTO global_settings (setting_key, setting_value, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [params.settingKey, JSON.stringify(params.newValue)],
  )
  return result.rows[0]
}

export async function getDeviationSlackChannel(): Promise<DeviationSlackChannelSettings> {
  return getGlobalSetting(GLOBAL_SETTING_KEYS.DEVIATION_SLACK_CHANNEL, DEFAULT_DEVIATION_SLACK_CHANNEL)
}

export async function updateDeviationSlackChannel(channelId: string): Promise<GlobalSetting> {
  return updateGlobalSetting({
    settingKey: GLOBAL_SETTING_KEYS.DEVIATION_SLACK_CHANNEL,
    newValue: { channel_id: channelId },
  })
}
