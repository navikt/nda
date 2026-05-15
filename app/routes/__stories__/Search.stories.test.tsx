import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './Search.stories'

vi.mock('react-router', async () => {
  const React = await import('react')

  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
    Form: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <form {...props}>{children}</form>
    ),
  }
})

const { Empty, ManyResults, NoResults, WithResults } = composeStories(stories)

describe('Search story baseline characterization', () => {
  it('renders empty search state and search input', () => {
    const html = renderToStaticMarkup(<Empty />)

    expect(html).toContain('Søk')
    expect(html).toContain('Bruk søkefeltet i header for å søke')
    expect(html).toContain('name="q"')
  })

  it('renders result entries and type tags for result scenario', () => {
    const html = renderToStaticMarkup(<WithResults />)

    expect(html).toContain('resultater for &quot;john&quot;')
    expect(html).toContain('Deployment')
    expect(html).toContain('Bruker')
  })

  it('renders no-results message for no-hit scenario', () => {
    const html = renderToStaticMarkup(<NoResults />)

    expect(html).toContain('Ingen resultater for &quot;xyz123&quot;')
  })

  it('renders extended set of results in many-results scenario', () => {
    const html = renderToStaticMarkup(<ManyResults />)

    expect(html).toContain('def456ghi789')
    expect(html).toContain('ghi789jkl012')
    expect(html).toContain('/users/jane-doe')
  })
})
