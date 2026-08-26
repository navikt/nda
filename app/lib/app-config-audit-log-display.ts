const SETTING_LABELS: Record<string, string> = {
  slack_notifications_enabled: 'Godkjenningsvarsler',
  slack_deploy_notify_enabled: 'Deployment-varsler',
  implicit_approval: 'Implisitt godkjenning',
}

export function configSettingLabel(settingKey: string): string {
  return SETTING_LABELS[settingKey] ?? settingKey
}

export function formatAuditLogTimestamp(date: Date | string | null): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatChangedBy(changedByName: string | null, changedByNavIdent: string): string {
  return changedByName || changedByNavIdent
}

interface EnabledChannelValue {
  enabled?: boolean
  channel_id?: string | null
}

function isEnabledChannelValue(
  value: Record<string, unknown> | null | undefined,
): value is Record<string, unknown> & EnabledChannelValue {
  if (!value) return false
  const hasValidEnabled = !('enabled' in value) || typeof value.enabled === 'boolean'
  const hasValidChannel = !('channel_id' in value) || value.channel_id === null || typeof value.channel_id === 'string'
  return ('enabled' in value || 'channel_id' in value) && hasValidEnabled && hasValidChannel
}

export function configChangeDescription(
  settingKey: string,
  oldValue: Record<string, unknown> | null | undefined,
  newValue: Record<string, unknown> | null | undefined,
): string {
  const label = configSettingLabel(settingKey)

  if (!isEnabledChannelValue(oldValue) && !isEnabledChannelValue(newValue)) {
    return `${label} oppdatert`
  }

  const oldEnabled = Boolean(oldValue?.enabled)
  const newEnabled = Boolean(newValue?.enabled)
  const oldChannel = (oldValue?.channel_id as string | null | undefined) ?? null
  const newChannel = (newValue?.channel_id as string | null | undefined) ?? null
  const enabledChanged = oldEnabled !== newEnabled
  const channelChanged = oldChannel !== newChannel

  if (!enabledChanged && !channelChanged) {
    return `${label} oppdatert`
  }

  const enabledPart = enabledChanged ? `${label} ${newEnabled ? 'aktivert' : 'deaktivert'}` : label
  const channelPart = newChannel ? `kanal endret til ${newChannel}` : 'kanal fjernet'

  if (enabledChanged && channelChanged) {
    return `${enabledPart} (${channelPart})`
  }

  if (enabledChanged) {
    return enabledPart
  }

  return `${label}: ${channelPart}`
}
