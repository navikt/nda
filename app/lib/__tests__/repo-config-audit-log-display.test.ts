import { describe, expect, it } from 'vitest'
import { repoConfigChangeDescription } from '~/lib/repo-config-audit-log-display'
import { REPOSITORY_SETTING_KEYS } from '~/lib/repository-setting-keys'

describe('repoConfigChangeDescription', () => {
  it('describes an audit_start_year change', () => {
    expect(
      repoConfigChangeDescription(
        REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR,
        { audit_start_year: 2022 },
        {
          audit_start_year: 2024,
        },
      ),
    ).toBe('Startår for revisjon: 2022 → 2024')
  })

  it('renders "ikke satt" when audit_start_year is null', () => {
    expect(
      repoConfigChangeDescription(
        REPOSITORY_SETTING_KEYS.AUDIT_START_YEAR,
        { audit_start_year: 2022 },
        {
          audit_start_year: null,
        },
      ),
    ).toBe('Startår for revisjon: 2022 → ikke satt')
  })

  it('describes an implicit_approval mode change with human-readable labels', () => {
    expect(
      repoConfigChangeDescription(REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL, { mode: 'off' }, { mode: 'all' }),
    ).toBe('Implisitt godkjenning: Av → Alle PRer')
  })

  it('renders "ikke satt" for an unknown or missing implicit_approval mode', () => {
    expect(repoConfigChangeDescription(REPOSITORY_SETTING_KEYS.IMPLICIT_APPROVAL, null, { mode: 'not-real' })).toBe(
      'Implisitt godkjenning: ikke satt → ikke satt',
    )
  })

  it('describes a default_branch change', () => {
    expect(
      repoConfigChangeDescription(
        REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
        { default_branch: 'master' },
        {
          default_branch: 'main',
        },
      ),
    ).toBe('Default branch: master → main')
  })

  it('renders "ikke satt" when default_branch is null', () => {
    expect(
      repoConfigChangeDescription(
        REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH,
        { default_branch: null },
        {
          default_branch: 'main',
        },
      ),
    ).toBe('Default branch: ikke satt → main')
  })

  it('renders "ikke satt" for both sides when values are null/undefined', () => {
    expect(repoConfigChangeDescription(REPOSITORY_SETTING_KEYS.DEFAULT_BRANCH, null, undefined)).toBe(
      'Default branch: ikke satt → ikke satt',
    )
  })

  it('falls back to the raw setting key label and "ikke satt" for an unknown setting key', () => {
    expect(repoConfigChangeDescription('some_future_setting', { foo: 'bar' }, { foo: 'baz' })).toBe(
      'some_future_setting: ikke satt → ikke satt',
    )
  })
})
