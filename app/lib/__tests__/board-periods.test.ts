import { describe, expect, it } from 'vitest'
import { formatBoardLabel, getCurrentPeriod, getPeriodsForYear, toDateInputValue } from '../board-periods'

describe('formatBoardLabel', () => {
  it('combines team name and period label with " - " separator', () => {
    expect(formatBoardLabel({ teamName: 'Skjermbildemodernisering', periodLabel: 'T1 2026' })).toBe(
      'Skjermbildemodernisering - T1 2026',
    )
  })

  it('handles quarterly period labels', () => {
    expect(formatBoardLabel({ teamName: 'Starte pensjon', periodLabel: 'Q2 2026' })).toBe('Starte pensjon - Q2 2026')
  })

  it('trims whitespace from inputs', () => {
    expect(formatBoardLabel({ teamName: '  Team  ', periodLabel: '  T1 2026  ' })).toBe('Team - T1 2026')
  })

  it('returns just the period label when team name is empty', () => {
    expect(formatBoardLabel({ teamName: '', periodLabel: 'T1 2026' })).toBe('T1 2026')
  })

  it('returns just the team name when period label is empty', () => {
    expect(formatBoardLabel({ teamName: 'Team', periodLabel: '' })).toBe('Team')
  })
})

describe('getCurrentPeriod', () => {
  describe('tertiary', () => {
    it.each([
      { date: new Date(2026, 0, 15), label: 'T1 2026', start: '2026-01-01', end: '2026-04-30' },
      { date: new Date(2026, 3, 30), label: 'T1 2026', start: '2026-01-01', end: '2026-04-30' },
      { date: new Date(2026, 4, 1), label: 'T2 2026', start: '2026-05-01', end: '2026-08-31' },
      { date: new Date(2026, 7, 31), label: 'T2 2026', start: '2026-05-01', end: '2026-08-31' },
      { date: new Date(2026, 8, 1), label: 'T3 2026', start: '2026-09-01', end: '2026-12-31' },
      { date: new Date(2026, 11, 31), label: 'T3 2026', start: '2026-09-01', end: '2026-12-31' },
    ])('$label for month $date.getMonth()', ({ date, label, start, end }) => {
      const result = getCurrentPeriod('tertiary', date)
      expect(result.label).toBe(label)
      expect(result.start).toBe(start)
      expect(result.end).toBe(end)
    })
  })

  describe('quarterly', () => {
    it.each([
      { date: new Date(2026, 0, 15), label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
      { date: new Date(2026, 2, 31), label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
      { date: new Date(2026, 3, 1), label: 'Q2 2026', start: '2026-04-01', end: '2026-06-30' },
      { date: new Date(2026, 5, 30), label: 'Q2 2026', start: '2026-04-01', end: '2026-06-30' },
      { date: new Date(2026, 6, 1), label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
      { date: new Date(2026, 8, 30), label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
      { date: new Date(2026, 9, 1), label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31' },
      { date: new Date(2026, 11, 31), label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31' },
    ])('$label for month $date.getMonth()', ({ date, label, start, end }) => {
      const result = getCurrentPeriod('quarterly', date)
      expect(result.label).toBe(label)
      expect(result.start).toBe(start)
      expect(result.end).toBe(end)
    })
  })

  describe('monthly', () => {
    it.each([
      { month: 0, date: new Date(2026, 0, 15), label: 'Januar 2026', start: '2026-01-01', end: '2026-01-31' },
      { month: 1, date: new Date(2026, 1, 10), label: 'Februar 2026', start: '2026-02-01', end: '2026-02-28' },
      { month: 4, date: new Date(2026, 4, 20), label: 'Mai 2026', start: '2026-05-01', end: '2026-05-31' },
      { month: 11, date: new Date(2026, 11, 31), label: 'Desember 2026', start: '2026-12-01', end: '2026-12-31' },
    ])('$label for month $month', ({ date, label, start, end }) => {
      const result = getCurrentPeriod('monthly', date)
      expect(result.label).toBe(label)
      expect(result.start).toBe(start)
      expect(result.end).toBe(end)
    })

    it('handles leap year February', () => {
      const result = getCurrentPeriod('monthly', new Date(2028, 1, 15))
      expect(result.label).toBe('Februar 2028')
      expect(result.end).toBe('2028-02-29')
    })
  })

  it('defaults to current date when none provided', () => {
    const result = getCurrentPeriod('quarterly')
    expect(result.label).toMatch(/^Q[1-4] \d{4}$/)
    expect(result.start).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe('getPeriodsForYear', () => {
  it('returns 3 tertiary periods', () => {
    const periods = getPeriodsForYear('tertiary', 2026)
    expect(periods).toHaveLength(3)
    expect(periods.map((p) => p.label)).toEqual(['T1 2026', 'T2 2026', 'T3 2026'])
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[1].start).toBe('2026-05-01')
    expect(periods[2].start).toBe('2026-09-01')
  })

  it('returns 4 quarterly periods', () => {
    const periods = getPeriodsForYear('quarterly', 2026)
    expect(periods).toHaveLength(4)
    expect(periods.map((p) => p.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'])
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[1].start).toBe('2026-04-01')
    expect(periods[2].start).toBe('2026-07-01')
    expect(periods[3].start).toBe('2026-10-01')
  })

  it('returns 12 monthly periods', () => {
    const periods = getPeriodsForYear('monthly', 2026)
    expect(periods).toHaveLength(12)
    expect(periods[0].label).toBe('Januar 2026')
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[0].end).toBe('2026-01-31')
    expect(periods[11].label).toBe('Desember 2026')
    expect(periods[11].start).toBe('2026-12-01')
    expect(periods[11].end).toBe('2026-12-31')
  })

  it('has continuous date ranges (no gaps)', () => {
    const periods = getPeriodsForYear('tertiary', 2026)
    for (let i = 1; i < periods.length; i++) {
      const prevEnd = new Date(periods[i - 1].end)
      const currStart = new Date(periods[i].start)
      prevEnd.setDate(prevEnd.getDate() + 1)
      expect(prevEnd.toISOString().split('T')[0]).toBe(currStart.toISOString().split('T')[0])
    }
  })

  it('covers full year for tertiary', () => {
    const periods = getPeriodsForYear('tertiary', 2026)
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[2].end).toBe('2026-12-31')
  })

  it('covers full year for quarterly', () => {
    const periods = getPeriodsForYear('quarterly', 2026)
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[3].end).toBe('2026-12-31')
  })

  it('covers full year for monthly', () => {
    const periods = getPeriodsForYear('monthly', 2026)
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[11].end).toBe('2026-12-31')
  })

  it('has continuous date ranges for monthly (no gaps)', () => {
    const periods = getPeriodsForYear('monthly', 2026)
    for (let i = 1; i < periods.length; i++) {
      const [y, m, d] = periods[i - 1].end.split('-').map(Number)
      const nextDay = new Date(Date.UTC(y, m - 1, d + 1))
      const nextDayStr = nextDay.toISOString().split('T')[0]
      expect(nextDayStr).toBe(periods[i].start)
    }
  })
})

describe('toDateInputValue', () => {
  it('converts a Date object to YYYY-MM-DD (reproduces pg DATE column behavior)', () => {
    const dateObj = new Date('2026-04-30T00:00:00')
    expect(toDateInputValue(dateObj)).toBe('2026-04-30')
  })

  it('extracts date from ISO string with time component', () => {
    expect(toDateInputValue('2026-04-30T00:00:00.000Z')).toBe('2026-04-30')
  })

  it('returns plain YYYY-MM-DD string as-is', () => {
    expect(toDateInputValue('2026-04-30')).toBe('2026-04-30')
  })
})
