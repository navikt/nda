/**
 * Report period utilities for yearly, quarterly, and monthly reports.
 * Shared between server and client code.
 */

import { toDateString } from './date-utils'

export type ReportPeriodType = 'yearly' | 'tertiary' | 'quarterly' | 'monthly'

const VALID_PERIOD_TYPES: ReadonlySet<string> = new Set<ReportPeriodType>([
  'yearly',
  'tertiary',
  'quarterly',
  'monthly',
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

/**
 * Get completed periods of a given type up to the reference date.
 * Only returns periods that are fully completed (end date is in the past).
 */
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

/**
 * Check if a period is completed (fully in the past).
 */
export function isPeriodCompleted(period: ReportPeriod, referenceDate: Date = new Date()): boolean {
  return period.endDate < referenceDate
}

/**
 * Generate a report ID incorporating the period type.
 */
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
}

/**
 * Resolve a period from periodType and periodStart date.
 * Returns the full period with label and endDate derived server-side,
 * or an error string if the input is invalid.
 *
 * Used by M2M API endpoints to avoid mismatches between periodStart and periodEnd.
 */
export function resolvePeriod(
  periodType: ReportPeriodType,
  periodStart: Date,
  auditStartYear: number | null,
): { period: ReportPeriod; error: null } | { period: null; error: string } {
  const year = periodStart.getFullYear()
  const month = periodStart.getMonth()
  const day = periodStart.getDate()

  // Validate audit_start_year constraint
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

  // Validate period is completed
  if (period.endDate >= new Date()) {
    return { period: null, error: 'Period has not ended yet' }
  }

  return { period, error: null }
}

/** Minimal shape needed to match existing reports against a selected period. */
interface ReportForPeriodMatch {
  period_type: ReportPeriodType
  period_start: Date
  archived_at: Date | null
  superseded_at: Date | null
}

/**
 * Find an active (non-archived, non-superseded) report that matches a selected period.
 * Used by the app admin UI to detect existing reports and offer superseding.
 */
export function findExistingReportForPeriod<T extends ReportForPeriodMatch>(
  reports: T[],
  selectedPeriod: ReportPeriod,
): T | undefined {
  return reports.find(
    (r) =>
      r.period_type === selectedPeriod.type &&
      toDateString(r.period_start) === toDateString(selectedPeriod.startDate) &&
      !r.archived_at &&
      !r.superseded_at,
  )
}
