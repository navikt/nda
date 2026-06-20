import { toDateString } from './date-utils'

export type ReportPeriodType = 'yearly' | 'tertiary' | 'quarterly' | 'monthly' | 'custom'

const VALID_PERIOD_TYPES: ReadonlySet<string> = new Set<ReportPeriodType>([
  'yearly',
  'tertiary',
  'quarterly',
  'monthly',
  'custom',
])

export function isValidReportPeriodType(value: string): value is ReportPeriodType {
  return VALID_PERIOD_TYPES.has(value)
}

export interface ReportPeriod {
  type: ReportPeriodType
  label: string
  year: number
  startDate: Date
  endDate: Date
}

const TERTIARY_LABELS: Record<number, string> = {
  0: 'T1',
  1: 'T2',
  2: 'T3',
}

const QUARTER_LABELS: Record<number, string> = {
  0: 'Q1',
  1: 'Q2',
  2: 'Q3',
  3: 'Q4',
}

const MONTH_LABELS = [
  'Januar',
  'Februar',
  'Mars',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Desember',
]

export function getCompletedPeriods(
  type: ReportPeriodType,
  referenceDate: Date = new Date(),
  startYear = 2024,
): ReportPeriod[] {
  const periods: ReportPeriod[] = []

  if (type === 'yearly') {
    for (let year = referenceDate.getFullYear() - 1; year >= startYear; year--) {
      periods.push({
        type: 'yearly',
        label: String(year),
        year,
        startDate: new Date(year, 0, 1),
        endDate: new Date(year, 11, 31, 23, 59, 59, 999),
      })
    }
  } else if (type === 'tertiary') {
    const currentTertiary = Math.floor(referenceDate.getMonth() / 4)
    const currentYear = referenceDate.getFullYear()

    for (let year = currentYear; year >= startYear; year--) {
      const maxT = year === currentYear ? currentTertiary - 1 : 2
      for (let t = maxT; t >= 0; t--) {
        const startMonth = t * 4
        periods.push({
          type: 'tertiary',
          label: `${TERTIARY_LABELS[t]} ${year}`,
          year,
          startDate: new Date(year, startMonth, 1),
          endDate: new Date(year, startMonth + 4, 0, 23, 59, 59, 999),
        })
      }
    }
  } else if (type === 'quarterly') {
    const currentQuarter = Math.floor(referenceDate.getMonth() / 3)
    const currentYear = referenceDate.getFullYear()

    for (let year = currentYear; year >= startYear; year--) {
      const maxQ = year === currentYear ? currentQuarter - 1 : 3
      for (let q = maxQ; q >= 0; q--) {
        const startMonth = q * 3
        periods.push({
          type: 'quarterly',
          label: `${QUARTER_LABELS[q]} ${year}`,
          year,
          startDate: new Date(year, startMonth, 1),
          endDate: new Date(year, startMonth + 3, 0, 23, 59, 59, 999),
        })
      }
    }
  } else if (type === 'monthly') {
    const currentYear = referenceDate.getFullYear()
    const currentMonth = referenceDate.getMonth()

    for (let year = currentYear; year >= startYear; year--) {
      const maxMonth = year === currentYear ? currentMonth - 1 : 11
      for (let month = maxMonth; month >= 0; month--) {
        periods.push({
          type: 'monthly',
          label: `${MONTH_LABELS[month]} ${year}`,
          year,
          startDate: new Date(year, month, 1),
          endDate: new Date(year, month + 1, 0, 23, 59, 59, 999),
        })
      }
    }
  }

  return periods
}

export function isPeriodCompleted(period: ReportPeriod, referenceDate: Date = new Date()): boolean {
  return period.endDate < referenceDate
}

export function generateReportId(
  _periodType: ReportPeriodType,
  periodLabel: string,
  appName: string,
  environment: string,
  hash: string,
): string {
  const shortHash = hash.substring(0, 8)
  const sanitizedLabel = periodLabel.replace(/\s+/g, '-')
  const uniqueSuffix = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `AUDIT-${sanitizedLabel}-${appName}-${environment}-${shortHash}-${uniqueSuffix}`
}

export const REPORT_PERIOD_TYPE_LABELS: Record<ReportPeriodType, string> = {
  yearly: 'Årlig',
  tertiary: 'Tertialsvis',
  quarterly: 'Kvartalsvis',
  monthly: 'Månedlig',
  custom: 'Egendefinert',
}

export function buildCustomPeriod(
  startYear: number,
  startMonthIndex: number,
  endYear: number,
  endMonthIndex: number,
): ReportPeriod | null {
  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(endYear) ||
    !Number.isInteger(startMonthIndex) ||
    !Number.isInteger(endMonthIndex) ||
    startMonthIndex < 0 ||
    startMonthIndex > 11 ||
    endMonthIndex < 0 ||
    endMonthIndex > 11
  ) {
    return null
  }
  const startDate = new Date(startYear, startMonthIndex, 1)
  const endDate = new Date(endYear, endMonthIndex + 1, 0, 23, 59, 59, 999)

  if (startDate > new Date(endYear, endMonthIndex, 1)) return null
  if (endDate >= new Date()) return null

  const sameYear = startYear === endYear
  const sameMonth = sameYear && startMonthIndex === endMonthIndex

  let label: string
  if (sameMonth) {
    label = `${MONTH_LABELS[startMonthIndex]} ${startYear}`
  } else if (sameYear) {
    label = `${MONTH_LABELS[startMonthIndex]} - ${MONTH_LABELS[endMonthIndex]} ${startYear}`
  } else {
    label = `${MONTH_LABELS[startMonthIndex]} ${startYear} - ${MONTH_LABELS[endMonthIndex]} ${endYear}`
  }

  return {
    type: 'custom',
    label,
    year: startYear,
    startDate,
    endDate,
  }
}

export function resolvePeriod(
  periodType: ReportPeriodType,
  periodStart: Date,
  auditStartYear: number | null,
): { period: ReportPeriod; error: null } | { period: null; error: string } {
  if (periodType === 'custom') {
    return {
      period: null,
      error: 'Custom period type is not supported via API. Use the admin UI to generate custom-range reports.',
    }
  }

  const year = periodStart.getFullYear()
  const month = periodStart.getMonth()
  const day = periodStart.getDate()

  if (auditStartYear !== null && year < auditStartYear) {
    return { period: null, error: `periodStart cannot be before audit start year (${auditStartYear}-01-01)` }
  }

  if (day !== 1 && periodType !== 'yearly') {
    return { period: null, error: 'periodStart must be the 1st of the month' }
  }

  let period: ReportPeriod

  if (periodType === 'yearly') {
    if (month !== 0 || day !== 1) {
      return { period: null, error: 'periodStart for yearly must be January 1st (YYYY-01-01)' }
    }
    period = {
      type: 'yearly',
      label: String(year),
      year,
      startDate: new Date(year, 0, 1),
      endDate: new Date(year, 11, 31, 23, 59, 59, 999),
    }
  } else if (periodType === 'tertiary') {
    const tertiaryIndex = Math.floor(month / 4)
    const expectedStartMonth = tertiaryIndex * 4
    if (month !== expectedStartMonth) {
      return { period: null, error: 'periodStart for tertiary must start in January, May, or September' }
    }
    const labels: Record<number, string> = TERTIARY_LABELS
    period = {
      type: 'tertiary',
      label: `${labels[tertiaryIndex]} ${year}`,
      year,
      startDate: new Date(year, expectedStartMonth, 1),
      endDate: new Date(year, expectedStartMonth + 4, 0, 23, 59, 59, 999),
    }
  } else if (periodType === 'quarterly') {
    const quarterIndex = Math.floor(month / 3)
    const expectedStartMonth = quarterIndex * 3
    if (month !== expectedStartMonth) {
      return { period: null, error: 'periodStart for quarterly must start in January, April, July, or October' }
    }
    const labels: Record<number, string> = QUARTER_LABELS
    period = {
      type: 'quarterly',
      label: `${labels[quarterIndex]} ${year}`,
      year,
      startDate: new Date(year, expectedStartMonth, 1),
      endDate: new Date(year, expectedStartMonth + 3, 0, 23, 59, 59, 999),
    }
  } else {
    period = {
      type: 'monthly',
      label: `${MONTH_LABELS[month]} ${year}`,
      year,
      startDate: new Date(year, month, 1),
      endDate: new Date(year, month + 1, 0, 23, 59, 59, 999),
    }
  }

  if (period.endDate >= new Date()) {
    return { period: null, error: 'Period has not ended yet' }
  }

  return { period, error: null }
}

interface ReportForPeriodMatch {
  period_type: ReportPeriodType
  period_start: Date
  period_end: Date
  archived_at: Date | null
  superseded_at: Date | null
}

export function findExistingReportForPeriod<T extends ReportForPeriodMatch>(
  reports: T[],
  selectedPeriod: ReportPeriod,
): T | undefined {
  return reports.find(
    (r) =>
      r.period_type === selectedPeriod.type &&
      toDateString(r.period_start) === toDateString(selectedPeriod.startDate) &&
      (selectedPeriod.type !== 'custom' || toDateString(r.period_end) === toDateString(selectedPeriod.endDate)) &&
      !r.archived_at &&
      !r.superseded_at,
  )
}
