import { describe, expect, it } from 'vitest'
import { isTimeMatch } from '../reminder-scheduler.server'

/**
 * Tests for reminder time-matching with ±2 minute tolerance.
 *
 * WHY: The reminder scheduler runs every minute and checks if the current time
 * matches the configured reminder time within a ±2 minute window. Off-by-one
 * errors here cause missed reminders (users don't get notified about unapproved
 * deployments) or duplicate sends (annoying Slack spam). The boundary cases
 * at exactly ±2 and ±3 minutes are critical.
 */

describe('isTimeMatch — checks if current time is within ±2 minutes of configured time', () => {
  it('matches exact time', () => {
    expect(isTimeMatch('09:00', '09:00')).toBe(true)
  })

  it('matches 1 minute before', () => {
    expect(isTimeMatch('09:00', '08:59')).toBe(true)
  })

  it('matches 1 minute after', () => {
    expect(isTimeMatch('09:00', '09:01')).toBe(true)
  })

  it('matches exactly 2 minutes before (boundary)', () => {
    expect(isTimeMatch('09:00', '08:58')).toBe(true)
  })

  it('matches exactly 2 minutes after (boundary)', () => {
    expect(isTimeMatch('09:00', '09:02')).toBe(true)
  })

  it('does NOT match 3 minutes before (outside window)', () => {
    expect(isTimeMatch('09:00', '08:57')).toBe(false)
  })

  it('does NOT match 3 minutes after (outside window)', () => {
    expect(isTimeMatch('09:00', '09:03')).toBe(false)
  })

  it('handles midnight boundary — configured 00:01, current 23:59', () => {
    // Note: current implementation uses Math.abs on raw minutes,
    // so 23:59 (1439 min) vs 00:01 (1 min) = diff 1438, NOT matching.
    // This documents the actual behavior (no midnight wrap-around).
    expect(isTimeMatch('00:01', '23:59')).toBe(false)
  })

  it('handles afternoon times', () => {
    expect(isTimeMatch('14:30', '14:31')).toBe(true)
    expect(isTimeMatch('14:30', '14:33')).toBe(false)
  })

  it('handles end of day', () => {
    expect(isTimeMatch('23:58', '23:59')).toBe(true)
  })
})
