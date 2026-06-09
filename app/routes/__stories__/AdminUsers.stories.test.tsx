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

const { Default, WithUnmappedUsers, Empty, MinimalData, OnlyUnmapped, WithoutGithub } = composeStories(stories)

describe('AdminUsers story baseline characterization', () => {
  it('renders default story with mapped users and no unmapped warning', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Brukermappinger')
    expect(html).toContain('Glad Fjord')
    // Produktleder uten GitHub vises uten GitHub-lenke
    expect(html).toContain('Stille Skog')
    expect(html).not.toContain('GitHub-brukere uten mapping')
  })

  it('renders story with unmapped users warning and list', () => {
    const html = renderToStaticMarkup(<WithUnmappedUsers />)

    expect(html).toContain('2 GitHub-brukere har deployments men mangler mapping')
    expect(html).toContain('GitHub-brukere uten mapping (2)')
    expect(html).toContain('unknown-deployer')
    expect(html).toContain('12 deployments')
    expect(html).toContain('Legg til mapping')
  })

  it('renders empty story info state', () => {
    const html = renderToStaticMarkup(<Empty />)

    expect(html).toContain(
      'Ingen brukermappinger er lagt til ennå. Klikk &quot;Legg til&quot; for å opprette den første.',
    )
    expect(html).not.toContain('GitHub-brukere uten mapping')
  })

  it('renders minimal data story with github-only mapping details', () => {
    const html = renderToStaticMarkup(<MinimalData />)

    expect(html).toContain('solo-user')
    expect(html).toContain('GitHub: solo-user')
    // GitHub-lenke vises i detaljraden; "Ingen tilleggsinformasjon" vises ikke
    // når brukeren har en GitHub-konto
    expect(html).not.toContain('Ingen tilleggsinformasjon')
  })

  it('renders user without github account', () => {
    const html = renderToStaticMarkup(<WithoutGithub />)

    expect(html).toContain('Modig Bjørk')
    expect(html).toContain('Z990099')
    expect(html).not.toContain('GitHub:')
  })

  it('renders only-unmapped story with both empty and warning states', () => {
    const html = renderToStaticMarkup(<OnlyUnmapped />)

    expect(html).toContain(
      'Ingen brukermappinger er lagt til ennå. Klikk &quot;Legg til&quot; for å opprette den første.',
    )
    expect(html).toContain('2 GitHub-brukere har deployments men mangler mapping')
    expect(html).toContain('GitHub-brukere uten mapping (2)')
  })
})
