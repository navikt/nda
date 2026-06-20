import { toDateString } from './date-utils'

interface HolidayMap {
  [key: string]: string
}

const holidayCache = new Map<number, HolidayMap>()

function calculateEasterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = Math.floor((h + l - 7 * m + 114) / 31)
  const o = (h + l - 7 * m + 114) % 31
  return new Date(year, n - 1, o + 1)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function computeHolidays(year: number): HolidayMap {
  const easter = calculateEasterSunday(year)

  const fixed: HolidayMap = {
    [`${year}-01-01`]: 'Første nyttårsdag',
    [`${year}-05-01`]: 'Arbeidernes dag',
    [`${year}-05-17`]: 'Grunnlovsdagen',
    [`${year}-12-25`]: 'Første juledag',
    [`${year}-12-26`]: 'Andre juledag',
  }

  const movable: HolidayMap = {
    [toDateString(addDays(easter, -3))]: 'Skjærtorsdag',
    [toDateString(addDays(easter, -2))]: 'Langfredag',
    [toDateString(easter)]: 'Første påskedag',
    [toDateString(addDays(easter, 1))]: 'Andre påskedag',
    [toDateString(addDays(easter, 39))]: 'Kristi himmelfartsdag',
    [toDateString(addDays(easter, 49))]: 'Første pinsedag',
    [toDateString(addDays(easter, 50))]: 'Andre pinsedag',
  }

  return { ...fixed, ...movable }
}

function getHolidaysForYear(year: number): HolidayMap {
  let holidays = holidayCache.get(year)
  if (!holidays) {
    holidays = computeHolidays(year)
    holidayCache.set(year, holidays)
  }
  return holidays
}

export function getPublicHolidays(year: number): Map<string, string> {
  return new Map(Object.entries(getHolidaysForYear(year)))
}

export function isPublicHoliday(date: Date): boolean {
  const day = date.getDay()
  if (day === 0 || day === 6) return true
  const key = toDateString(date)
  return key in getHolidaysForYear(date.getFullYear())
}

export function isBusinessDay(date: Date): boolean {
  return !isPublicHoliday(date)
}

export function getWeekdayKey(date: Date): string {
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return days[date.getDay()]
}
