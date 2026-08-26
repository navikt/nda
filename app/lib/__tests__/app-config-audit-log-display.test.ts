import { describe, expect, it } from 'vitest'
import {
  configChangeDescription,
  configSettingLabel,
  formatAuditLogTimestamp,
  formatChangedBy,
} from '~/lib/app-config-audit-log-display'

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

describe('configChangeDescription', () => {
  it('describes an enabled -> disabled transition', () => {
    expect(
      configChangeDescription(
        'slack_deploy_notify_enabled',
        { enabled: true, channel_id: 'C0DEPLOY1' },
        { enabled: false, channel_id: 'C0DEPLOY1' },
      ),
    ).toBe('Deployment-varsler deaktivert')
  })

  it('describes a disabled -> enabled transition', () => {
    expect(
      configChangeDescription(
        'slack_notifications_enabled',
        { enabled: false, channel_id: 'C0123456' },
        { enabled: true, channel_id: 'C0123456' },
      ),
    ).toBe('Godkjenningsvarsler aktivert')
  })

  it('describes a channel-only change when enabled is unchanged', () => {
    expect(
      configChangeDescription(
        'slack_deploy_notify_enabled',
        { enabled: true, channel_id: 'C0DEPLOY1' },
        { enabled: true, channel_id: 'C0NEWCHAN' },
      ),
    ).toBe('Deployment-varsler: kanal endret til C0NEWCHAN')
  })

  it('describes a channel removal when enabled is unchanged', () => {
    expect(
      configChangeDescription(
        'slack_deploy_notify_enabled',
        { enabled: true, channel_id: 'C0DEPLOY1' },
        { enabled: true, channel_id: null },
      ),
    ).toBe('Deployment-varsler: kanal fjernet')
  })

  it('describes a simultaneous enabled and channel change', () => {
    expect(
      configChangeDescription(
        'slack_deploy_notify_enabled',
        { enabled: false, channel_id: null },
        { enabled: true, channel_id: 'C0NEWCHAN' },
      ),
    ).toBe('Deployment-varsler aktivert (kanal endret til C0NEWCHAN)')
  })

  it('falls back to a generic label when neither old nor new value has enabled/channel_id fields', () => {
    expect(configChangeDescription('implicit_approval', { mode: 'off' }, { mode: 'strict' })).toBe(
      'Implisitt godkjenning oppdatert',
    )
  })

  it('handles a null old_value (first recorded change)', () => {
    expect(
      configChangeDescription('slack_deploy_notify_enabled', null, { enabled: true, channel_id: 'C0DEPLOY1' }),
    ).toBe('Deployment-varsler aktivert (kanal endret til C0DEPLOY1)')
  })

  it('falls back to a generic label when nothing actually changed', () => {
    expect(
      configChangeDescription(
        'slack_deploy_notify_enabled',
        { enabled: true, channel_id: 'C0DEPLOY1' },
        { enabled: true, channel_id: 'C0DEPLOY1' },
      ),
    ).toBe('Deployment-varsler oppdatert')
  })
})
