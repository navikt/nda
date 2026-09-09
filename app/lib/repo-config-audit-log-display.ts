import { REPOSITORY_SETTING_KEYS } from '~/lib/repository-setting-keys'
import { IMPLICIT_APPROVAL_MODE_LABELS, isImplicitApprovalMode } from '~/lib/verification/types'

const REPO_SETTING_LABELS: Record<string, string> = {
  [REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR]: 'Startår for revisjon',
  [REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL]: 'Implisitt godkjenning',
  [REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH]: 'Default branch',
}

function formatRepoSettingValue(settingKey: string, value: Record<string, unknown> | null | undefined): string {
  if (!value) return 'ikke satt'

  if (settingKey === REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR) {
    const year = value.audit_start_year
    return year == null ? 'ikke satt' : String(year)
  }

  if (settingKey === REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL) {
    const mode = value.mode
    if (typeof mode === 'string' && isImplicitApprovalMode(mode)) {
      return IMPLICIT_APPROVAL_MODE_LABELS[mode]
    }
    return 'ikke satt'
  }

  if (settingKey === REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH) {
    const branch = value.default_branch
    return branch == null ? 'ikke satt' : String(branch)
  }

  return 'ikke satt'
}

export function repoConfigChangeDescription(
  settingKey: string,
  oldValue: Record<string, unknown> | null | undefined,
  newValue: Record<string, unknown> | null | undefined,
): string {
  const label = REPO_SETTING_LABELS[settingKey] ?? settingKey
  const oldFormatted = formatRepoSettingValue(settingKey, oldValue)
  const newFormatted = formatRepoSettingValue(settingKey, newValue)
  return `${label}: ${oldFormatted} → ${newFormatted}`
}
