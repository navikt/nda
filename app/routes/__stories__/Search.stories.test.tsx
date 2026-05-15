import { composeStories } from '@storybook/react'
import type { JSX, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './Search.stories'

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')

  return {
    ...actual,
    Form: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <form {...props}>{children}</form>
    ),
  }
})

const { Empty, ManyResults, NoResults, WithResults } = composeStories(stories)

function renderStory(StoryComponent: () => JSX.Element) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StoryComponent />
    </MemoryRouter>,
  )
}

describe('Search story baseline characterization', () => {
  it('renders empty search state and search input', () => {
    const html = renderStory(Empty)

    expect(html).toContain('Søk')
    expect(html).toContain('Bruk søkefeltet i header for å søke')
    expect(html).toContain('name="q"')
  })

  it('renders result entries and type tags for result scenario', () => {
    const html = renderStory(WithResults)

    expect(html).toContain('resultater for &quot;john&quot;')
    expect(html).toContain('Deployment')
    expect(html).toContain('Bruker')
  })

  it('renders no-results message for no-hit scenario', () => {
    const html = renderStory(NoResults)

    expect(html).toContain('Ingen resultater for &quot;xyz123&quot;')
  })

  it('renders extended set of results in many-results scenario', () => {
    const html = renderStory(ManyResults)

    expect(html).toContain('def456ghi789')
    expect(html).toContain('ghi789jkl012')
    expect(html).toContain('/users/jane-doe')
  })
})
