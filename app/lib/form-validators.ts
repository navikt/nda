const NAV_IDENT_REGEX = /^[a-zA-Z]\d{6}$/
const SLACK_CHANNEL_REGEX = /^(C[A-Z0-9]+|#[\w-]+)$/i
const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9]))*$/

export function isValidNavIdent(value: string): boolean {
  return NAV_IDENT_REGEX.test(value)
}

export function isValidSlackChannel(value: string): boolean {
  return SLACK_CHANNEL_REGEX.test(value)
}

export function isValidGitHubUsername(value: string): boolean {
  return value.length <= 39 && GITHUB_USERNAME_REGEX.test(value)
}

export function getFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : null
}

export function parseAuditStartYear(formData: FormData): number | string {
  const raw = getFormString(formData, 'audit_start_year')
  if (raw === null || raw === '') {
    return 'Startår for revisjon er påkrevd.'
  }
  const currentYear = new Date().getFullYear()
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > currentYear + 1) {
    return `Startår må være et helt tall mellom 2000 og ${currentYear + 1}.`
  }
  return parsed
}
