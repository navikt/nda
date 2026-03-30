/**
 * Board period helpers — compute tertial/quarterly start/end dates and labels.
 */

export type BoardPeriodType = 'tertiary' | 'quarterly'

interface BoardPeriod {
  type: BoardPeriodType
  label: string
  start: string // ISO date (YYYY-MM-DD)
  end: string // ISO date (YYYY-MM-DD)
}

function getTertial(month: number): 1 | 2 | 3 {
  if (month < 4) return 1
  if (month < 8) return 2
  return 3
}

function getQuarter(month: number): 1 | 2 | 3 | 4 {
  if (month < 3) return 1
  if (month < 6) return 2
  if (month < 9) return 3
  return 4
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getCurrentPeriod(type: BoardPeriodType, date = new Date()): BoardPeriod {
  const year = date.getFullYear()
  const month = date.getMonth()

  if (type === 'tertiary') {
    const t = getTertial(month)
    const startMonth = (t - 1) * 4
    const endMonth = startMonth + 3
    return {
      type,
      label: `T${t} ${year}`,
      start: `${year}-${String(startMonth + 1).padStart(2, '0')}-01`,
      end: formatLocalDate(new Date(year, endMonth + 1, 0)),
    }
  }

  const q = getQuarter(month)
  const startMonth = (q - 1) * 3
  const endMonth = startMonth + 2
  return {
    type,
    label: `Q${q} ${year}`,
    start: `${year}-${String(startMonth + 1).padStart(2, '0')}-01`,
    end: formatLocalDate(new Date(year, endMonth + 1, 0)),
  }
}

/** Get a list of periods for the given year and type. */
export function getPeriodsForYear(type: BoardPeriodType, year: number): BoardPeriod[] {
  const count = type === 'tertiary' ? 3 : 4
  return Array.from({ length: count }, (_, i) => {
    const month = type === 'tertiary' ? i * 4 : i * 3
    return getCurrentPeriod(type, new Date(year, month, 15))
  })
}
