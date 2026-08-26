const SETTING_LABELS: Record<string, string> = {
  slack_notifications_enabled: 'Godkjenningsvarsler',
  slack_deploy_notify_enabled: 'Deployment-varsler',
  implicit_approval: 'Implisitt godkjenning',
}

export function configSettingLabel(settingKey: string): string {
  return SETTING_LABELS[settingKey] ?? settingKey
}

export function formatAuditLogTimestamp(date: Date | string): string {
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
