import { describe, expect, it } from 'vitest'
import { endOfDay } from '../date-utils'

describe('endOfDay', () => {
  it('sets time to 23:59:59.999', () => {
    const result = endOfDay(new Date('2026-04-30'))
    expect(result.getHours()).toBe(23)
    expect(result.getMinutes()).toBe(59)
    expect(result.getSeconds()).toBe(59)
    expect(result.getMilliseconds()).toBe(999)
  })

  it('preserves the date', () => {
    const result = endOfDay(new Date('2026-04-30'))
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(3)
    expect(result.getDate()).toBe(30)
  })

  it('does not mutate the original date', () => {
    const original = new Date('2026-04-30T12:00:00')
    endOfDay(original)
    expect(original.getHours()).toBe(12)
  })

  it('makes a timestamp later in the same day less than or equal', () => {
    const periodEnd = endOfDay(new Date('2026-04-30'))
    const deploymentTime = new Date('2026-04-30T14:30:00')
    expect(deploymentTime <= periodEnd).toBe(true)
  })

  it('makes a timestamp on the next day greater', () => {
    const periodEnd = endOfDay(new Date('2026-04-30'))
    const nextDay = new Date('2026-05-01T00:00:00')
    expect(nextDay > periodEnd).toBe(true)
  })
})
