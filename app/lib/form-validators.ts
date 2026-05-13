const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAV_IDENT_REGEX = /^[a-zA-Z]\d{6}$/
const SLACK_CHANNEL_REGEX = /^(C[A-Z0-9]+|#[\w-]+)$/i
const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9]))*$/

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value)
}

export function isValidNavIdent(value: string): boolean {
  return NAV_IDENT_REGEX.test(value)
}

export function isValidSlackChannel(value: string): boolean {
  return SLACK_CHANNEL_REGEX.test(value)
}

export function isValidGitHubUsername(value: string): boolean {
  return value.length <= 39 && GITHUB_USERNAME_REGEX.test(value)
}

/**
 * Safely read a string field from FormData.
 *
 * Guards against the (rare but possible) case where the client sends a
 * non-string value (e.g. a `File`), which would otherwise cause a
 * runtime TypeError when calling `.trim()` on the cast result.
 *
 * Returns the trimmed string, or `null` if the field is missing or not a
 * string.
 */
export function getFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : null
}

/**
 * Parse and validate an audit start year from form data.
 *
 * Returns the parsed year as a number, or an error message string if invalid.
 * Accepts years between 2000 and currentYear + 1.
 */
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
