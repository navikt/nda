import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './Admin.stories'

vi.mock('react-router', async () => {
  const React = await import('react')

  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const { Default, WithPendingVerifications, WithMultipleDeviations } = composeStories(stories)

describe('Admin story baseline characterization', () => {
  it('renders all admin entry points when there are no highlighted deviations', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Administrasjon')
    expect(html).toContain('/deployments/verify')
    expect(html).toContain('/admin/audit-reports')
    expect(html).toContain('/admin/users')
    expect(html).toContain('/admin/sync-jobs')
    expect(html).toContain('/admin/global-settings')
    expect(html).toContain('/admin/env')
    expect(html).toContain('/admin/monorepos')
    expect(html).toContain('/admin/workflow-triggers')
    expect(html).toContain('/admin/workflow-patterns')
    expect(html).toContain('/admin/verification-diffs')
    expect(html).toContain('/admin/data-mismatches')
    expect(html).toContain('/admin/soft-deleted')
    expect(html).toContain('/sections')
    expect(html).toContain('/admin/section-roles')
    expect(html).toContain('/admin/validate-monitored-apps')
    expect(html).toContain('Verifiser deployments mot GitHub.')
    expect(html).toContain('Sjekk verifiseringsavvik på tvers av alle applikasjoner.')
    expect(html).toContain('Tittel-avvik, baseline uten godkjenner og andre datakvalitetsproblemer.')
    expect(html).toContain('Se og gjenopprett logisk slettede rader.')
    expect(html).not.toContain('deployments venter på verifisering.')
  })

  it('renders pending verification messaging when pending deployments exist', () => {
    const html = renderToStaticMarkup(<WithPendingVerifications />)

    expect(html).toContain('5 deployments venter på verifisering.')
    expect(html).toContain('GitHub-verifisering')
  })

  it('renders warning and danger copy when multiple deviation counts exist', () => {
    const html = renderToStaticMarkup(<WithMultipleDeviations />)

    expect(html).toContain('3 deployments venter på verifisering.')
    expect(html).toContain('2 avvik funnet på tvers av applikasjoner.')
    expect(html).toContain('3 datakvalitetsproblemer funnet. Sjekk siden.')
    expect(html).toContain('4 logisk slettede rader. Se hvem som slettet og gjenopprett ved behov.')
  })
})
