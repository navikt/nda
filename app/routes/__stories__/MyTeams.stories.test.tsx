import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './MyTeams.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const { MedTavler, IngenTeamValgt, ManglerEndringsopphav, IngenGitHubMapping, MedGrupperteApps } =
  composeStories(stories)

describe('MyTeams story baseline characterization', () => {
  it('renders healthy baseline with team metrics, board section, and summary state', () => {
    const html = renderToStaticMarkup(<MedTavler />)

    expect(html).toContain('Mine team')
    expect(html).toContain('Deployments i år')
    expect(html).toContain('4-øyne dekning')
    expect(html).toContain('100%')
    expect(html).toContain('Endringsopphav')
    expect(html).toContain('97%')
    expect(html).toContain('Samlet helsetilstand')
    expect(html).toContain('Akseptabel')
    expect(html).toContain('Aktive måltavler')
    expect(html).toContain('Alle dine deployments har endringsopphav og alle applikasjoner er i orden')
  })

  it('renders no-team-selected onboarding state', () => {
    const html = renderToStaticMarkup(<IngenTeamValgt />)

    expect(html).toContain('Du har ikke valgt noen utviklingsteam ennå.')
    expect(html).toContain('Min profil')
    expect(html).not.toContain('Deployments i år')
  })

  it('renders missing goal-link warning and issue app section', () => {
    const html = renderToStaticMarkup(<ManglerEndringsopphav />)

    expect(html).toContain('47 av dine deployments mangler endringsopphav.')
    expect(html).toContain('Koble mine deployments')
    expect(html).toContain('Applikasjoner som trenger oppfølging (2)')
  })

  it('renders no-github-mapping guidance state', () => {
    const html = renderToStaticMarkup(<IngenGitHubMapping />)

    expect(html).toContain('må du legge til GitHub-brukernavnet ditt i NDA-profilen')
    expect(html).toContain('Åpne min profil')
  })

  it('renders grouped apps variant details', () => {
    const html = renderToStaticMarkup(<MedGrupperteApps />)

    expect(html).toContain('psak-og-penny')
    expect(html).toContain('pensjon-penny')
    expect(html).toContain('prod-gcp')
    expect(html).toContain('Koble mine deployments')
  })
})
