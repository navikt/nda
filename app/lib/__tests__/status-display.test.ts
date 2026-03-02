import { describe, expect, it } from 'vitest'
import { formatChangeSource, getFourEyesStatus } from '../status-display'

/**
 * Tests for user-facing status display text.
 *
 * WHY: These functions produce the Norwegian text shown in the UI for every deployment.
 * If someone renames a status string or changes the switch/case, these tests catch
 * that the user-visible text, variant (color), and description change accordingly.
 * Without these tests, a refactor could silently break the UI labels.
 */

describe('getFourEyesStatus — maps deployment status to user-visible label, variant and description', () => {
  const cases: Array<{
    status: string
    hasFourEyes: boolean
    expectedText: string
    expectedVariant: string
  }> = [
    { status: 'approved', hasFourEyes: false, expectedText: 'Godkjent', expectedVariant: 'success' },
    { status: 'approved_pr', hasFourEyes: false, expectedText: 'Godkjent', expectedVariant: 'success' },
    { status: 'baseline', hasFourEyes: false, expectedText: 'Baseline', expectedVariant: 'success' },
    { status: 'pending_baseline', hasFourEyes: false, expectedText: 'Foreslått baseline', expectedVariant: 'warning' },
    { status: 'no_changes', hasFourEyes: false, expectedText: 'Ingen endringer', expectedVariant: 'success' },
    {
      status: 'unverified_commits',
      hasFourEyes: false,
      expectedText: 'Ikke-verifiserte commits',
      expectedVariant: 'error',
    },
    {
      status: 'approved_pr_with_unreviewed',
      hasFourEyes: false,
      expectedText: 'Ureviewed commits i merge',
      expectedVariant: 'error',
    },
    { status: 'legacy', hasFourEyes: false, expectedText: 'Legacy', expectedVariant: 'success' },
    { status: 'legacy_pending', hasFourEyes: false, expectedText: 'Legacy (venter)', expectedVariant: 'warning' },
    { status: 'manually_approved', hasFourEyes: false, expectedText: 'Manuelt godkjent', expectedVariant: 'success' },
    {
      status: 'implicitly_approved',
      hasFourEyes: false,
      expectedText: 'Implisitt godkjent',
      expectedVariant: 'success',
    },
    { status: 'direct_push', hasFourEyes: false, expectedText: 'Direct push', expectedVariant: 'warning' },
    { status: 'missing', hasFourEyes: false, expectedText: 'Mangler godkjenning', expectedVariant: 'error' },
    { status: 'error', hasFourEyes: false, expectedText: 'Feil ved verifisering', expectedVariant: 'error' },
    { status: 'pending', hasFourEyes: false, expectedText: 'Venter på verifisering', expectedVariant: 'info' },
  ]

  for (const { status, hasFourEyes, expectedText, expectedVariant } of cases) {
    it(`status "${status}" → text "${expectedText}", variant "${expectedVariant}"`, () => {
      const result = getFourEyesStatus({ four_eyes_status: status, has_four_eyes: hasFourEyes })
      expect(result.text).toBe(expectedText)
      expect(result.variant).toBe(expectedVariant)
      expect(result.description).toBeTruthy()
    })
  }

  it('falls back to "Godkjent" when has_four_eyes=true but status is unknown', () => {
    const result = getFourEyesStatus({ four_eyes_status: 'some_future_status', has_four_eyes: true })
    expect(result.text).toBe('Godkjent')
    expect(result.variant).toBe('success')
  })

  it('falls back to "Ukjent status" when both status and has_four_eyes are unrecognized', () => {
    const result = getFourEyesStatus({ four_eyes_status: 'some_future_status', has_four_eyes: false })
    expect(result.text).toBe('Ukjent status')
    expect(result.variant).toBe('info')
    expect(result.description).toContain('some_future_status')
  })

  it('includes meaningful description for every status', () => {
    for (const { status, hasFourEyes } of cases) {
      const result = getFourEyesStatus({ four_eyes_status: status, has_four_eyes: hasFourEyes })
      expect(result.description.length).toBeGreaterThan(10)
    }
  })
})

describe('formatChangeSource — translates change source keys to Norwegian labels', () => {
  const sources: Array<[string, string]> = [
    ['verification', 'Verifisering'],
    ['manual_approval', 'Manuell godkjenning'],
    ['reverification', 'Reverifisering'],
    ['sync', 'Synkronisering'],
    ['legacy', 'Legacy'],
    ['baseline_approval', 'Baseline godkjent'],
    ['unknown', 'Ukjent'],
  ]

  for (const [key, expected] of sources) {
    it(`"${key}" → "${expected}"`, () => {
      expect(formatChangeSource(key)).toBe(expected)
    })
  }

  it('returns the raw key when no label mapping exists (forward-compatible)', () => {
    expect(formatChangeSource('new_future_source')).toBe('new_future_source')
  })
})
