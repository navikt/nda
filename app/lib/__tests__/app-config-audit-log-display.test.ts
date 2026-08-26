import { describe, expect, it } from 'vitest'
import { configSettingLabel, formatAuditLogTimestamp, formatChangedBy } from '~/lib/app-config-audit-log-display'

describe('configSettingLabel', () => {
  it('returns a friendly label for known Slack setting keys', () => {
    expect(configSettingLabel('slack_notifications_enabled')).toBe('Godkjenningsvarsler')
    expect(configSettingLabel('slack_deploy_notify_enabled')).toBe('Deployment-varsler')
  })

  it('returns a friendly label for the implicit approval setting key', () => {
    expect(configSettingLabel('implicit_approval')).toBe('Implisitt godkjenning')
  })

  it('falls back to the raw setting key for unknown keys', () => {
    expect(configSettingLabel('some_future_setting')).toBe('some_future_setting')
  })
})

describe('formatChangedBy', () => {
  it('prefers the name when present', () => {
    expect(formatChangedBy('Glad Fjord', 'Z990001')).toBe('Glad Fjord')
  })

  it('falls back to the NAV-ident when name is null', () => {
    expect(formatChangedBy(null, 'Z990001')).toBe('Z990001')
  })
})

describe('formatAuditLogTimestamp', () => {
  it('formats a date consistently in nb-NO locale', () => {
    const formatted = formatAuditLogTimestamp('2026-03-01T08:00:00Z')
    expect(formatted).toMatch(/\d{2}\.\d{2}\.\d{4}/)
  })

  it('accepts a Date instance as well as a string', () => {
    const date = new Date('2026-03-01T08:00:00Z')
    expect(formatAuditLogTimestamp(date)).toBe(formatAuditLogTimestamp(date.toISOString()))
  })
})
