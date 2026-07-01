import { composeStories } from '@storybook/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './User.stories'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
      React.createElement('form', props, children),
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

vi.mock('~/components/DeploymentActivityChart', () => ({
  DeploymentActivityChart: () => null,
}))

const { Default, NoMapping, PartialMapping, NoDeployments, OwnProfile, WithGoalLinking } = composeStories(stories)

describe('User story baseline characterization', () => {
  it('renders default story with identity cards and deployment list', () => {
    const html = renderToStaticMarkup(<Default />)

    expect(html).toContain('Glad Fjord')
    expect(html).toContain('Leveranser (42)')
    expect(html).toContain('Åpne i Slack')
    expect(html).toContain('pensjon-pen')
    expect(html).toContain('/team/pensjondeployer/env/prod-fss/app/pensjon-pen')
    expect(html).toContain('Pensjon Pen')
    expect(html).toContain('Pensjon Samhandling')
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
    expect(html).toContain('Leveranser (10)')
    expect(html).toContain('Z990001')
    expect(html).not.toContain('Åpne i Slack')
    expect(html).not.toContain('glad.fjord@nav.no')
  })

  it('renders no-deployments empty state baseline', () => {
    const html = renderToStaticMarkup(<NoDeployments />)

    expect(html).toContain('Leveranser (0)')
    expect(html).toContain('Ingen leveranser funnet for denne brukeren.')
  })

  it('renders own profile with landing page preferences', () => {
    const html = renderToStaticMarkup(<OwnProfile />)

    expect(html).toContain('Landingsside')
    expect(html).toContain('Mine team')
    expect(html).toContain('Alle seksjoner')
    expect(html).toContain('Seksjon A&amp;Y')
    expect(html).toContain('Pensjon')
  })

  it('renders goal linking actions when boards are available', () => {
    const html = renderToStaticMarkup(<WithGoalLinking />)

    expect(html).toContain('Koble Dependabot til endringsopphav')
  })
})
