import { describe, expect, it } from 'vitest'
import { toDateString } from '../date-utils'
import {
  buildCustomPeriod,
  findExistingReportForPeriod,
  generateReportId,
  getCompletedPeriods,
  isPeriodCompleted,
  type ReportPeriod,
  resolvePeriod,
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

describe('toDateString', () => {
  it('formats Date as YYYY-MM-DD', () => {
    expect(toDateString(new Date(2025, 0, 1))).toBe('2025-01-01')
    expect(toDateString(new Date(2025, 11, 31))).toBe('2025-12-31')
    expect(toDateString(new Date(2026, 4, 1))).toBe('2026-05-01')
  })

  it('pads single-digit month and day', () => {
    expect(toDateString(new Date(2025, 0, 5))).toBe('2025-01-05')
    expect(toDateString(new Date(2025, 8, 9))).toBe('2025-09-09')
  })
})

describe('resolvePeriod', () => {
  const pastYear = new Date().getFullYear() - 1

  function expectSuccess(result: ReturnType<typeof resolvePeriod>) {
    expect(result.error).toBeNull()
    if (result.error !== null) throw new Error('Expected success')
    return result.period
  }

  describe('yearly', () => {
    it('resolves valid yearly period', () => {
      const period = expectSuccess(resolvePeriod('yearly', new Date(pastYear, 0, 1), null))
      expect(period.type).toBe('yearly')
      expect(period.label).toBe(`${pastYear}`)
      expect(period.year).toBe(pastYear)
      expect(period.startDate).toEqual(new Date(pastYear, 0, 1))
      expect(period.endDate).toEqual(new Date(pastYear, 11, 31, 23, 59, 59, 999))
    })

    it('rejects non-January start', () => {
      const result = resolvePeriod('yearly', new Date(pastYear, 3, 1), null)
      expect(result.error).toContain('January 1st')
    })

    it('rejects non-first day', () => {
      const result = resolvePeriod('yearly', new Date(pastYear, 0, 15), null)
      expect(result.error).toContain('January 1st')
    })
  })

  describe('tertiary', () => {
    it('resolves T1 (January start)', () => {
      const period = expectSuccess(resolvePeriod('tertiary', new Date(pastYear, 0, 1), null))
      expect(period.label).toBe(`T1 ${pastYear}`)
      expect(period.startDate).toEqual(new Date(pastYear, 0, 1))
      expect(period.endDate).toEqual(new Date(pastYear, 3, 30, 23, 59, 59, 999))
    })

    it('resolves T2 (May start)', () => {
      const period = expectSuccess(resolvePeriod('tertiary', new Date(pastYear, 4, 1), null))
      expect(period.label).toBe(`T2 ${pastYear}`)
    })

    it('resolves T3 (September start)', () => {
      const period = expectSuccess(resolvePeriod('tertiary', new Date(pastYear, 8, 1), null))
      expect(period.label).toBe(`T3 ${pastYear}`)
    })

    it('rejects invalid start month', () => {
      const result = resolvePeriod('tertiary', new Date(pastYear, 2, 1), null)
      expect(result.error).toContain('January, May, or September')
    })

    it('rejects non-first day', () => {
      const result = resolvePeriod('tertiary', new Date(pastYear, 0, 15), null)
      expect(result.error).toContain('1st of the month')
    })
  })

  describe('quarterly', () => {
    it('resolves Q1 (January start)', () => {
      const period = expectSuccess(resolvePeriod('quarterly', new Date(pastYear, 0, 1), null))
      expect(period.label).toBe(`Q1 ${pastYear}`)
      expect(period.startDate).toEqual(new Date(pastYear, 0, 1))
      expect(period.endDate).toEqual(new Date(pastYear, 2, 31, 23, 59, 59, 999))
    })

    it('resolves Q2 (April start)', () => {
      const period = expectSuccess(resolvePeriod('quarterly', new Date(pastYear, 3, 1), null))
      expect(period.label).toBe(`Q2 ${pastYear}`)
    })

    it('resolves Q3 (July start)', () => {
      const period = expectSuccess(resolvePeriod('quarterly', new Date(pastYear, 6, 1), null))
      expect(period.label).toBe(`Q3 ${pastYear}`)
    })

    it('resolves Q4 (October start)', () => {
      const period = expectSuccess(resolvePeriod('quarterly', new Date(pastYear, 9, 1), null))
      expect(period.label).toBe(`Q4 ${pastYear}`)
    })

    it('rejects invalid start month', () => {
      const result = resolvePeriod('quarterly', new Date(pastYear, 1, 1), null)
      expect(result.error).toContain('January, April, July, or October')
    })
  })

  describe('monthly', () => {
    it('resolves valid monthly period', () => {
      const period = expectSuccess(resolvePeriod('monthly', new Date(pastYear, 5, 1), null))
      expect(period.label).toBe(`Juni ${pastYear}`)
      expect(period.startDate).toEqual(new Date(pastYear, 5, 1))
      expect(period.endDate).toEqual(new Date(pastYear, 5, 30, 23, 59, 59, 999))
    })

    it('rejects non-first day', () => {
      const result = resolvePeriod('monthly', new Date(pastYear, 5, 15), null)
      expect(result.error).toContain('1st of the month')
    })
  })

  describe('auditStartYear constraint', () => {
    it('rejects period before audit start year', () => {
      const result = resolvePeriod('yearly', new Date(2023, 0, 1), 2024)
      expect(result.error).toContain('audit start year')
      expect(result.error).toContain('2024')
    })

    it('accepts period at audit start year', () => {
      const result = resolvePeriod('yearly', new Date(2024, 0, 1), 2024)
      expect(result.error).toBeNull()
    })

    it('accepts period when auditStartYear is null', () => {
      const result = resolvePeriod('yearly', new Date(2020, 0, 1), null)
      expect(result.error).toBeNull()
    })
  })

  describe('period completion', () => {
    it('rejects period that has not ended yet', () => {
      const futureYear = new Date().getFullYear() + 1
      const result = resolvePeriod('yearly', new Date(futureYear, 0, 1), null)
      expect(result.error).toContain('not ended yet')
    })
  })
})

describe('findExistingReportForPeriod', () => {
  const makePeriod = (type: ReportPeriod['type'], startDate: Date, endDate?: Date): ReportPeriod => ({
    type,
    label: 'Test',
    year: startDate.getFullYear(),
    startDate,
    endDate: endDate ?? new Date(startDate.getFullYear(), 11, 31),
  })

  const makeReport = (overrides: {
    period_type: ReportPeriod['type']
    period_start: Date
    period_end?: Date
    archived_at?: Date | null
    superseded_at?: Date | null
  }) => ({
    id: 1,
    report_id: 'test-report',
    period_type: overrides.period_type,
    period_start: overrides.period_start,
    period_end: overrides.period_end ?? new Date(overrides.period_start.getFullYear(), 11, 31),
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

  it('matches custom period on both period_start and period_end', () => {
    const reports = [
      makeReport({ period_type: 'custom', period_start: new Date(2025, 0, 1), period_end: new Date(2025, 2, 31) }),
    ]
    const period = makePeriod('custom', new Date(2025, 0, 1), new Date(2025, 2, 31))
    expect(findExistingReportForPeriod(reports, period)).toBe(reports[0])
  })

  it('does not match custom period with same start but different end', () => {
    const reports = [
      makeReport({ period_type: 'custom', period_start: new Date(2025, 0, 1), period_end: new Date(2025, 2, 31) }),
    ]
    const period = makePeriod('custom', new Date(2025, 0, 1), new Date(2025, 5, 30))
    expect(findExistingReportForPeriod(reports, period)).toBeUndefined()
  })

  it('old .slice() approach crashes on Date objects from node-postgres', () => {
    // This test documents the bug: the old inline code in the admin route used
    // r.period_start.slice(0, 10) assuming period_start was a string.
    // node-postgres returns DATE columns as Date objects, so .slice() is undefined.
    const pgDate = new Date(2025, 0, 1)
    expect(() => (pgDate as unknown as { slice: (start: number, end: number) => string }).slice(0, 10)).toThrow(
      /slice is not a function/,
    )
  })
})

describe('buildCustomPeriod', () => {
  it('returns null for a period that has not ended yet', () => {
    const now = new Date()
    expect(buildCustomPeriod(now.getFullYear(), now.getMonth(), now.getFullYear(), now.getMonth())).toBeNull()
  })

  it('returns null when start is after end', () => {
    expect(buildCustomPeriod(2025, 5, 2025, 3)).toBeNull() // June → April
  })

  it('returns null for out-of-range month index', () => {
    expect(buildCustomPeriod(2025, -1, 2025, 0)).toBeNull()
    expect(buildCustomPeriod(2025, 0, 2025, 12)).toBeNull()
    expect(buildCustomPeriod(2025, 13, 2025, 13)).toBeNull()
  })

  it('returns null for non-integer arguments', () => {
    expect(buildCustomPeriod(2025.5, 0, 2025, 0)).toBeNull()
    expect(buildCustomPeriod(2025, 0.5, 2025, 0)).toBeNull()
    expect(buildCustomPeriod(2025, 0, 2025, Number.NaN)).toBeNull()
  })

  it('single month: label matches monthly format', () => {
    const period = buildCustomPeriod(2025, 0, 2025, 0) // January 2025
    expect(period).not.toBeNull()
    expect(period?.label).toBe('Januar 2025')
    expect(period?.type).toBe('custom')
    expect(period?.year).toBe(2025)
    expect(period?.startDate).toEqual(new Date(2025, 0, 1))
    expect(period?.endDate).toEqual(new Date(2025, 0, 31, 23, 59, 59, 999))
  })

  it('same year range: label is "Month - Month YYYY"', () => {
    const period = buildCustomPeriod(2025, 0, 2025, 4) // January - May 2025
    expect(period).not.toBeNull()
    expect(period?.label).toBe('Januar - Mai 2025')
    expect(period?.startDate).toEqual(new Date(2025, 0, 1))
    expect(period?.endDate).toEqual(new Date(2025, 4, 31, 23, 59, 59, 999))
  })

  it('cross-year range: label is "Month YYYY - Month YYYY"', () => {
    const period = buildCustomPeriod(2024, 10, 2025, 1) // November 2024 - February 2025
    expect(period).not.toBeNull()
    expect(period?.label).toBe('November 2024 - Februar 2025')
    expect(period?.startDate).toEqual(new Date(2024, 10, 1))
    expect(period?.endDate).toEqual(new Date(2025, 1, 28, 23, 59, 59, 999))
    expect(period?.year).toBe(2024)
  })

  it('end month date is last day of the month', () => {
    const period = buildCustomPeriod(2024, 0, 2024, 1) // January - February 2024 (leap year)
    expect(period).not.toBeNull()
    expect(period?.endDate.getDate()).toBe(29) // 2024 is a leap year
  })
})

describe('getCompletedPeriods (custom)', () => {
  it('returns empty array for custom type', () => {
    const ref = new Date(2026, 5, 15)
    const periods = getCompletedPeriods('custom', ref)
    expect(periods).toEqual([])
  })
})

describe('resolvePeriod (custom)', () => {
  it('returns error for custom period type', () => {
    const result = resolvePeriod('custom', new Date(2025, 0, 1), null)
    expect(result.error).toContain('Custom period type is not supported via API')
    expect(result.period).toBeNull()
  })
})
