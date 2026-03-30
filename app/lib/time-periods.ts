/**
 * Unified time period definitions for filtering deployments
 */

export type TimePeriod =
  | 'last-week'
  | 'current-month'
  | 'last-month'
  | 'current-tertial'
  | 'last-tertial'
  | 'year-to-date'
  | 'last-year'
  | 'all'

interface TimePeriodOption {
  value: TimePeriod
  label: string
}

/**
 * Available time periods in order from shortest to longest
 */
export const TIME_PERIOD_OPTIONS: TimePeriodOption[] = [
  { value: 'last-week', label: 'Siste 7 dager' },
  { value: 'current-month', label: 'Inneværende måned' },
  { value: 'last-month', label: 'Forrige måned' },
  { value: 'current-tertial', label: 'Inneværende tertial' },
  { value: 'last-tertial', label: 'Forrige tertial' },
  { value: 'year-to-date', label: 'Hittil i år' },
  { value: 'last-year', label: 'Forrige år' },
  { value: 'all', label: 'Alle' },
]

/**
 * Get the tertial (1, 2, or 3) for a given month (0-11)
 * Tertial 1: Jan-Apr (months 0-3)
 * Tertial 2: May-Aug (months 4-7)
 * Tertial 3: Sep-Dec (months 8-11)
 */
function getTertial(month: number): 1 | 2 | 3 {
  if (month <= 3) return 1
  if (month <= 7) return 2
  return 3
}

/**
 * Get the start month (0-11) for a given tertial
 */
function getTertialStartMonth(tertial: 1 | 2 | 3): number {
  switch (tertial) {
    case 1:
      return 0 // January
    case 2:
      return 4 // May
    case 3:
      return 8 // September
  }
}

/**
 * Calculate date range for a given time period
 */
export function getDateRangeForPeriod(period: TimePeriod): { startDate: Date; endDate: Date } | null {
  if (period === 'all') {
    return null
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()
  let startDate: Date
  let endDate: Date = now

  switch (period) {
    case 'last-week':
      startDate = new Date(now)
      startDate.setDate(now.getDate() - 7)
      break

    case 'current-month':
      startDate = new Date(currentYear, currentMonth, 1)
      break

    case 'last-month': {
      const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1
      const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear
      startDate = new Date(lastMonthYear, lastMonth, 1)
      endDate = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999) // Last day of previous month
      break
    }

    case 'current-tertial': {
      const currentTertial = getTertial(currentMonth)
      const startMonth = getTertialStartMonth(currentTertial)
      startDate = new Date(currentYear, startMonth, 1)
      break
    }

    case 'last-tertial': {
      const currentTertial = getTertial(currentMonth)
      let lastTertial: 1 | 2 | 3
      let year = currentYear

      if (currentTertial === 1) {
        lastTertial = 3
        year = currentYear - 1
      } else {
        lastTertial = (currentTertial - 1) as 1 | 2
      }

      const startMonth = getTertialStartMonth(lastTertial)
      startDate = new Date(year, startMonth, 1)
      // End at last day of the tertial (4 months later, day 0 = last day of previous month)
      endDate = new Date(year, startMonth + 4, 0, 23, 59, 59, 999)
      break
    }

    case 'year-to-date':
      startDate = new Date(currentYear, 0, 1)
      break

    case 'last-year':
      startDate = new Date(currentYear - 1, 0, 1)
      endDate = new Date(currentYear - 1, 11, 31, 23, 59, 59, 999)
      break

    default:
      return null
  }

  return { startDate, endDate }
}
