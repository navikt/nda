import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './Deployments.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
      React.createElement('form', props, children),
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const { Default, Empty, SinglePage, MiddlePage, MixedStatuses } = composeStories(stories)

describe('Deployments story baseline characterization', () => {
  it('renders default story with summary and pagination controls', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('42 deployments funnet')
    expect(html).toContain('Side 1 av 3')
    expect(html).toContain('Forrige')
    expect(html).toContain('Neste')
    expect(html).toContain('#42')
  })

  it('renders empty state story without pagination', () => {
    const html = renderToStaticMarkup(<Empty />)

    expect(html).toContain('0 deployments funnet')
    expect(html).toContain('Ingen deployments funnet med valgte filtre.')
    expect(html).not.toContain('Side 1 av')
  })

  it('hides pagination when only one page exists', () => {
    const html = renderToStaticMarkup(<SinglePage />)

    expect(html).toContain('3 deployments funnet')
    expect(html).not.toContain('Side 1 av 1')
  })

  it('renders middle-page pagination correctly', () => {
    const html = renderToStaticMarkup(<MiddlePage />)

    expect(html).toContain('100 deployments funnet')
    expect(html).toContain('Side 3 av 5')
  })

  it('renders mixed statuses baseline titles', () => {
    const html = renderToStaticMarkup(<MixedStatuses />)

    expect(html).toContain('5 deployments funnet')
    expect(html).toContain('Manuelt godkjent deployment')
    expect(html).toContain('Deployment med feil')
  })
})
