import { describe, expect, it } from 'vitest'
import { formatChangeSource, getFourEyesStatus } from '../status-display'

describe('getFourEyesStatus — maps deployment status to user-visible label, variant and description', () => {
  const cases: Array<{
    status: string
    expectedText: string
    expectedVariant: string
  }> = [
    { status: 'approved', expectedText: 'Godkjent', expectedVariant: 'success' },
    { status: 'approved_pr', expectedText: 'Godkjent', expectedVariant: 'success' },
    { status: 'baseline', expectedText: 'Baseline', expectedVariant: 'success' },
    { status: 'pending_baseline', expectedText: 'Foreslått baseline', expectedVariant: 'warning' },
    { status: 'no_changes', expectedText: 'Ingen endringer', expectedVariant: 'success' },
    {
      status: 'unverified_commits',
      expectedText: 'Ikke-godkjente commits',
      expectedVariant: 'error',
    },
    {
      status: 'approved_pr_with_unreviewed',
      expectedText: 'Ureviewed commits i merge',
      expectedVariant: 'error',
    },
    { status: 'legacy', expectedText: 'Legacy', expectedVariant: 'success' },
    { status: 'legacy_pending', expectedText: 'Legacy (venter)', expectedVariant: 'warning' },
    { status: 'manually_approved', expectedText: 'Manuelt godkjent', expectedVariant: 'success' },
    {
      status: 'implicitly_approved',
      expectedText: 'Implisitt godkjent',
      expectedVariant: 'success',
    },
    { status: 'direct_push', expectedText: 'Direct push', expectedVariant: 'warning' },
    { status: 'unauthorized_branch', expectedText: 'Ikke på godkjent branch', expectedVariant: 'error' },
    {
      status: 'unauthorized_repository',
      expectedText: 'Ikke godkjent repository',
      expectedVariant: 'error',
    },
    { status: 'missing', expectedText: 'Mangler godkjenning', expectedVariant: 'error' },
    { status: 'error', expectedText: 'Feil ved verifisering', expectedVariant: 'error' },
    { status: 'pending', expectedText: 'Venter på verifisering', expectedVariant: 'info' },
  ]

  for (const { status, expectedText, expectedVariant } of cases) {
    it(`status "${status}" → text "${expectedText}", variant "${expectedVariant}"`, () => {
      const result = getFourEyesStatus({ four_eyes_status: status })
      expect(result.text).toBe(expectedText)
      expect(result.variant).toBe(expectedVariant)
      expect(result.description).toBeTruthy()
    })
  }

  it('falls back to "Ukjent status" for unknown statuses', () => {
    const result = getFourEyesStatus({ four_eyes_status: 'some_future_status' })
    expect(result.text).toBe('Ukjent status')
    expect(result.variant).toBe('info')
    expect(result.description).toContain('some_future_status')
  })

  it('includes meaningful description for every status', () => {
    for (const { status } of cases) {
      const result = getFourEyesStatus({ four_eyes_status: status })
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
