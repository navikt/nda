import { describe, expect, it } from 'vitest'
import {
  findExistingReportForPeriod,
  formatDateKey,
  generateReportId,
  getCompletedPeriods,
  isPeriodCompleted,
  type ReportPeriod,
} from '../report-periods'

describe('getCompletedPeriods', () => {
  describe('yearly', () => {
    it('returns only completed years', () => {
      const ref = new Date(2026, 5, 15) // June 15, 2026
      const periods = getCompletedPeriods('yearly', ref)

      expect(periods[0].label).toBe('2025')
      expect(periods[0].year).toBe(2025)
      expect(periods[0].startDate).toEqual(new Date(2025, 0, 1))
      expect(periods[0].endDate).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999))

      // Should not include 2026 (current year)
      expect(periods.every((p) => p.year < 2026)).toBe(true)
    })

    it('returns years in descending order', () => {
      const ref = new Date(2026, 5, 15)
      const periods = getCompletedPeriods('yearly', ref)
      for (let i = 1; i < periods.length; i++) {
        expect(periods[i - 1].year).toBeGreaterThan(periods[i].year)
      }
    })
  })

  describe('quarterly', () => {
    it('returns only completed quarters', () => {
      const ref = new Date(2026, 4, 10) // May 10, 2026 (Q2)
      const periods = getCompletedPeriods('quarterly', ref)

      // Q1 2026 should be completed (ended Mar 31)
      expect(periods[0].label).toBe('Q1 2026')
      expect(periods[0].startDate).toEqual(new Date(2026, 0, 1))
      expect(periods[0].endDate).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999))

      // Q2 2026 should NOT be included (we're in it)
      expect(periods.find((p) => p.label === 'Q2 2026')).toBeUndefined()
    })

    it('handles start of quarter correctly', () => {
      const ref = new Date(2026, 3, 1) // April 1 (start of Q2)
      const periods = getCompletedPeriods('quarterly', ref)
      expect(periods[0].label).toBe('Q1 2026')
    })

    it('returns Q3 and Q4 of previous year', () => {
      const ref = new Date(2026, 1, 15) // Feb 15, 2026 (Q1)
      const periods = getCompletedPeriods('quarterly', ref)

      // No quarters in 2026 should be complete yet
      expect(periods[0].label).toBe('Q4 2025')
      expect(periods[1].label).toBe('Q3 2025')
    })

    it('computes correct end-of-quarter dates', () => {
      const ref = new Date(2026, 11, 31)
      const periods = getCompletedPeriods('quarterly', ref)

      const q1 = periods.find((p) => p.label === 'Q1 2026')
      expect(q1).toBeDefined()
      expect(q1?.endDate.getMonth()).toBe(2) // March
      expect(q1?.endDate.getDate()).toBe(31)

      const q2 = periods.find((p) => p.label === 'Q2 2026')
      expect(q2).toBeDefined()
      expect(q2?.endDate.getMonth()).toBe(5) // June
      expect(q2?.endDate.getDate()).toBe(30)

      const q3 = periods.find((p) => p.label === 'Q3 2026')
      expect(q3).toBeDefined()
      expect(q3?.endDate.getMonth()).toBe(8) // September
      expect(q3?.endDate.getDate()).toBe(30)
    })
  })

  describe('tertiary', () => {
    it('returns only completed tertialer', () => {
      const ref = new Date(2026, 5, 15) // June 15, 2026 (T2)
      const periods = getCompletedPeriods('tertiary', ref)

      // T1 2026 should be completed (ended Apr 30)
      expect(periods[0].label).toBe('T1 2026')
      expect(periods[0].startDate).toEqual(new Date(2026, 0, 1))
      expect(periods[0].endDate).toEqual(new Date(2026, 3, 30, 23, 59, 59, 999))

      // T2 2026 should NOT be included (we're in it)
      expect(periods.find((p) => p.label === 'T2 2026')).toBeUndefined()
    })

    it('handles start of tertial correctly', () => {
      const ref = new Date(2026, 4, 1) // May 1 (start of T2)
      const periods = getCompletedPeriods('tertiary', ref)
      expect(periods[0].label).toBe('T1 2026')
    })

    it('returns T3 of previous year when in T1', () => {
      const ref = new Date(2026, 2, 15) // March 15, 2026 (T1)
      const periods = getCompletedPeriods('tertiary', ref)

      // No tertialer in 2026 should be complete yet
      expect(periods[0].label).toBe('T3 2025')
      expect(periods[1].label).toBe('T2 2025')
    })

    it('computes correct end-of-tertial dates', () => {
      const ref = new Date(2026, 11, 31)
      const periods = getCompletedPeriods('tertiary', ref)

      const t1 = periods.find((p) => p.label === 'T1 2026')
      expect(t1?.endDate.getMonth()).toBe(3) // April
      expect(t1?.endDate.getDate()).toBe(30)

      const t2 = periods.find((p) => p.label === 'T2 2026')
      expect(t2?.endDate.getMonth()).toBe(7) // August
      expect(t2?.endDate.getDate()).toBe(31)

      const t3 = periods.find((p) => p.label === 'T3 2025')
      expect(t3?.endDate.getMonth()).toBe(11) // December
      expect(t3?.endDate.getDate()).toBe(31)
    })
  })

  describe('monthly', () => {
    it('returns only completed months', () => {
      const ref = new Date(2026, 2, 15) // March 15, 2026
      const periods = getCompletedPeriods('monthly', ref)

      expect(periods[0].label).toBe('Februar 2026')
      expect(periods[1].label).toBe('Januar 2026')

      // March should NOT be included
      expect(periods.find((p) => p.label === 'Mars 2026')).toBeUndefined()
    })

    it('handles end-of-month dates correctly', () => {
      const ref = new Date(2026, 3, 1) // April 1
      const periods = getCompletedPeriods('monthly', ref)

      const feb = periods.find((p) => p.label === 'Februar 2026')
      expect(feb).toBeDefined()
      expect(feb?.endDate.getDate()).toBe(28) // 2026 is not a leap year

      const jan = periods.find((p) => p.label === 'Januar 2026')
      expect(jan).toBeDefined()
      expect(jan?.endDate.getDate()).toBe(31)
    })

    it('handles leap year February', () => {
      const ref = new Date(2028, 3, 1) // April 1, 2028 (leap year)
      const periods = getCompletedPeriods('monthly', ref)
      const feb = periods.find((p) => p.label === 'Februar 2028')
      expect(feb).toBeDefined()
      expect(feb?.endDate.getDate()).toBe(29)
    })

    it('returns months in descending order', () => {
      const ref = new Date(2026, 6, 1)
      const periods = getCompletedPeriods('monthly', ref)
      expect(periods[0].label).toBe('Juni 2026')
      expect(periods[1].label).toBe('Mai 2026')
      expect(periods[2].label).toBe('April 2026')
    })
  })

  describe('startYear filtering', () => {
    it('yearly: excludes years before startYear', () => {
      const ref = new Date(2026, 5, 15)
      const periods = getCompletedPeriods('yearly', ref, 2025)
      expect(periods.length).toBe(1)
      expect(periods[0].label).toBe('2025')
    })

    it('quarterly: excludes quarters before startYear', () => {
      const ref = new Date(2026, 5, 15)
      const periods = getCompletedPeriods('quarterly', ref, 2026)
      // Only Q1 2026 should be included (Q1 ended Mar 31)
      expect(periods.every((p) => p.year >= 2026)).toBe(true)
      expect(periods[0].label).toBe('Q1 2026')
    })

    it('tertiary: excludes tertialer before startYear', () => {
      const ref = new Date(2026, 5, 15)
      const periods = getCompletedPeriods('tertiary', ref, 2026)
      expect(periods.every((p) => p.year >= 2026)).toBe(true)
      expect(periods[0].label).toBe('T1 2026')
    })

    it('monthly: excludes months before startYear', () => {
      const ref = new Date(2026, 2, 15)
      const periods = getCompletedPeriods('monthly', ref, 2026)
      expect(periods.every((p) => p.year >= 2026)).toBe(true)
      expect(periods[0].label).toBe('Februar 2026')
      expect(periods[1].label).toBe('Januar 2026')
      expect(periods.length).toBe(2)
    })

    it('returns empty when startYear is current year and no periods completed', () => {
      const ref = new Date(2026, 0, 15) // Jan 15
      const periods = getCompletedPeriods('yearly', ref, 2026)
      expect(periods.length).toBe(0)
    })
  })
})

describe('isPeriodCompleted', () => {
  it('returns true for past periods', () => {
    const period: ReportPeriod = {
      type: 'monthly',
      label: 'Januar 2025',
      year: 2025,
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2025, 0, 31, 23, 59, 59, 999),
    }
    expect(isPeriodCompleted(period, new Date(2025, 1, 1))).toBe(true)
  })

  it('returns false for current/future periods', () => {
    const period: ReportPeriod = {
      type: 'monthly',
      label: 'Mars 2026',
      year: 2026,
      startDate: new Date(2026, 2, 1),
      endDate: new Date(2026, 2, 31, 23, 59, 59, 999),
    }
    expect(isPeriodCompleted(period, new Date(2026, 2, 15))).toBe(false)
  })
})

describe('generateReportId', () => {
  it('generates yearly report ID with unique suffix', () => {
    const id = generateReportId('yearly', '2025', 'pensjon-pen', 'prod-gcp', 'abcdef1234567890')
    expect(id).toMatch(/^AUDIT-2025-pensjon-pen-prod-gcp-abcdef12-[a-z0-9]+$/)
  })

  it('generates quarterly report ID with sanitized label', () => {
    const id = generateReportId('quarterly', 'Q3 2025', 'pensjon-pen', 'prod-gcp', 'abcdef1234567890')
    expect(id).toMatch(/^AUDIT-Q3-2025-pensjon-pen-prod-gcp-abcdef12-[a-z0-9]+$/)
  })

  it('generates monthly report ID with sanitized label', () => {
    const id = generateReportId('monthly', 'Oktober 2025', 'pensjon-pen', 'prod-gcp', 'abcdef1234567890')
    expect(id).toMatch(/^AUDIT-Oktober-2025-pensjon-pen-prod-gcp-abcdef12-[a-z0-9]+$/)
  })

  it('generates unique IDs for identical inputs', () => {
    const id1 = generateReportId('yearly', '2025', 'pensjon-pen', 'prod-gcp', 'abcdef1234567890')
    const id2 = generateReportId('yearly', '2025', 'pensjon-pen', 'prod-gcp', 'abcdef1234567890')
    expect(id1).not.toBe(id2)
  })
})

describe('formatDateKey', () => {
  it('formats Date as YYYY-MM-DD', () => {
    expect(formatDateKey(new Date(2025, 0, 1))).toBe('2025-01-01')
    expect(formatDateKey(new Date(2025, 11, 31))).toBe('2025-12-31')
    expect(formatDateKey(new Date(2026, 4, 1))).toBe('2026-05-01')
  })

  it('pads single-digit month and day', () => {
    expect(formatDateKey(new Date(2025, 0, 5))).toBe('2025-01-05')
    expect(formatDateKey(new Date(2025, 8, 9))).toBe('2025-09-09')
  })
})

describe('findExistingReportForPeriod', () => {
  const makePeriod = (type: ReportPeriod['type'], startDate: Date): ReportPeriod => ({
    type,
    label: 'Test',
    year: startDate.getFullYear(),
    startDate,
    endDate: new Date(startDate.getFullYear(), 11, 31),
  })

  const makeReport = (overrides: {
    period_type: ReportPeriod['type']
    period_start: Date
    archived_at?: Date | null
    superseded_at?: Date | null
  }) => ({
    id: 1,
    report_id: 'test-report',
    period_type: overrides.period_type,
    period_start: overrides.period_start,
    archived_at: overrides.archived_at ?? null,
    superseded_at: overrides.superseded_at ?? null,
  })

  it('finds matching report for period', () => {
    const reports = [makeReport({ period_type: 'yearly', period_start: new Date(2025, 0, 1) })]
    const period = makePeriod('yearly', new Date(2025, 0, 1))
    expect(findExistingReportForPeriod(reports, period)).toBe(reports[0])
  })

  it('handles period_start as Date object (as returned by node-postgres for DATE columns)', () => {
    // node-postgres returns DATE columns as Date objects, not strings.
    // The old code used .slice(0, 10) which crashes on Date objects.
    const pgDate = new Date(2025, 0, 1) // This is what pg actually returns
    const reports = [makeReport({ period_type: 'tertiary', period_start: pgDate })]
    const period = makePeriod('tertiary', new Date(2025, 0, 1))

    // This must not throw — the old inline code threw:
    // "t.period_start.slice is not a function"
    expect(() => findExistingReportForPeriod(reports, period)).not.toThrow()
    expect(findExistingReportForPeriod(reports, period)).toBe(reports[0])
  })

  it('does not match different period types', () => {
    const reports = [makeReport({ period_type: 'yearly', period_start: new Date(2025, 0, 1) })]
    const period = makePeriod('tertiary', new Date(2025, 0, 1))
    expect(findExistingReportForPeriod(reports, period)).toBeUndefined()
  })

  it('does not match different start dates', () => {
    const reports = [makeReport({ period_type: 'tertiary', period_start: new Date(2025, 0, 1) })]
    const period = makePeriod('tertiary', new Date(2025, 4, 1))
    expect(findExistingReportForPeriod(reports, period)).toBeUndefined()
  })

  it('skips archived reports', () => {
    const reports = [makeReport({ period_type: 'yearly', period_start: new Date(2025, 0, 1), archived_at: new Date() })]
    const period = makePeriod('yearly', new Date(2025, 0, 1))
    expect(findExistingReportForPeriod(reports, period)).toBeUndefined()
  })

  it('skips superseded reports', () => {
    const reports = [
      makeReport({ period_type: 'yearly', period_start: new Date(2025, 0, 1), superseded_at: new Date() }),
    ]
    const period = makePeriod('yearly', new Date(2025, 0, 1))
    expect(findExistingReportForPeriod(reports, period)).toBeUndefined()
  })

  it('old .slice() approach crashes on Date objects from node-postgres', () => {
    // This test documents the bug: the old inline code in the admin route used
    // r.period_start.slice(0, 10) assuming period_start was a string.
    // node-postgres returns DATE columns as Date objects, so .slice() is undefined.
    const pgDate = new Date(2025, 0, 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (pgDate as any).slice(0, 10)).toThrow(/slice is not a function/)
  })
})
