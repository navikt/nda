export function endOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

export function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
