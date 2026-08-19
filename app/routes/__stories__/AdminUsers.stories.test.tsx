import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './AdminUsers.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
    Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
      React.createElement('form', props, children),
  }
})

const { Default, WithUnmappedUsers, Empty, MinimalData, OnlyUnmapped, AllTabs } = composeStories(stories)

describe('AdminUsers story baseline characterization', () => {
  it('renders default story with mapped users and no unmapped warning', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Brukermappinger')
    expect(html).toContain('Glad Fjord')
    expect(html).toContain('minimal-user')
    expect(html).toContain('Ingen tilleggsinformasjon')
    expect(html).not.toContain('har deployments men mangler')
  })

  it('renders tabs with counts for mappings, unmapped users and users without github', () => {
    const html = renderToStaticMarkup(<AllTabs />)

    expect(html).toContain('Brukere (4)')
    expect(html).toContain('GitHub-brukere uten mapping (2)')
    expect(html).toContain('Brukere uten GitHub-konto (2)')
  })

  it('renders story with unmapped users warning referencing the tab', () => {
    const html = renderToStaticMarkup(<WithUnmappedUsers />)

    expect(html).toContain('2 GitHub-brukere har deployments men mangler mapping')
    expect(html).toContain('Se fanen &quot;GitHub-brukere uten mapping&quot; for detaljer')
    expect(html).toContain('GitHub-brukere uten mapping (2)')
  })

  it('renders empty story info state', () => {
    const html = renderToStaticMarkup(<Empty />)

    expect(html).toContain(
      'Ingen brukermappinger er lagt til ennå. Klikk &quot;Legg til&quot; for å opprette den første.',
    )
    expect(html).not.toContain('har deployments men mangler')
  })

  it('renders minimal data story with github-only mapping details', () => {
    const html = renderToStaticMarkup(<MinimalData />)

    expect(html).toContain('solo-user')
    expect(html).toContain('GitHub: solo-user')
    expect(html).toContain('Ingen tilleggsinformasjon')
  })

  it('renders only-unmapped story with empty mappings state and unmapped tab count', () => {
    const html = renderToStaticMarkup(<OnlyUnmapped />)

    expect(html).toContain(
      'Ingen brukermappinger er lagt til ennå. Klikk &quot;Legg til&quot; for å opprette den første.',
    )
    expect(html).toContain('2 GitHub-brukere har deployments men mangler mapping')
    expect(html).toContain('GitHub-brukere uten mapping (2)')
  })
})
