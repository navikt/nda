import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './User.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const { Default, NoMapping, PartialMapping, NoDeployments } = composeStories(stories)

describe('User story baseline characterization', () => {
  it('renders default story with identity cards and deployment list', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Glad Fjord')
    expect(html).toContain('Siste deployments (42)')
    expect(html).toContain('glad.fjord@nav.no')
    expect(html).toContain('Åpne i Slack')
    expect(html).toContain('pensjon-pen')
    expect(html).toContain('/team/pensjondeployer/env/prod-fss/app/pensjon-pen')
  })

  it('renders no-mapping warning baseline', () => {
    const html = renderToStaticMarkup(<NoMapping />)

    expect(html).toContain('unknown-user')
    expect(html).toContain('Ingen brukermapping funnet for denne brukeren.')
    expect(html).toContain('Opprett mapping')
    expect(html).not.toContain('glad.fjord@nav.no')
  })

  it('renders partial mapping without optional contact fields', () => {
    const html = renderToStaticMarkup(<PartialMapping />)

    expect(html).toContain('Rolig Dal')
    expect(html).toContain('Siste deployments (10)')
    expect(html).toContain('Z990001')
    expect(html).not.toContain('Åpne i Slack')
    expect(html).not.toContain('glad.fjord@nav.no')
  })

  it('renders no-deployments empty state baseline', () => {
    const html = renderToStaticMarkup(<NoDeployments />)

    expect(html).toContain('Siste deployments (0)')
    expect(html).toContain('Ingen deployments funnet for denne brukeren.')
    expect(html).not.toContain('pensjon-pen')
  })
})
