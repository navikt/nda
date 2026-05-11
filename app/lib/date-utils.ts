/**
 * Sets a Date to the end of the day (23:59:59.999).
 * Useful when comparing a timestamp against a date-only period boundary.
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parses a YYYY-MM-DD string as a local-time Date (midnight in the system timezone).
 * Unlike `new Date('YYYY-MM-DD')` which parses as UTC midnight, this avoids
 * off-by-hours issues when the server runs in a non-UTC timezone (e.g. Europe/Oslo).
 * Throws on malformed input.
 */
export function parseLocalDate(dateStr: string): Date {
  if (!DATE_PATTERN.test(dateStr)) {
    throw new Error(`Ugyldig datoformat: '${dateStr}' (forventet YYYY-MM-DD)`)
  }
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`Ugyldig dato: '${dateStr}'`)
  }
  return date
}

/**
 * Formats a Date as a YYYY-MM-DD string using local time.
 * Safe to use as a date-only SQL parameter with `::date` cast,
 * avoiding timezone-dependent `timestamptz::date` implicit casts.
 */
export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
