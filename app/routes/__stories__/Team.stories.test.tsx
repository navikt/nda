import { composeStories } from '@storybook/react'
import type { JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import * as stories from './Team.stories'

const { Default, MultipleEnvironments, SingleEnvironment } = composeStories(stories)

function renderStory(StoryComponent: () => JSX.Element) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StoryComponent />
    </MemoryRouter>,
  )
}

describe('Team story baseline characterization', () => {
  it('renders default story with expected team and environment sections', () => {
    const html = renderStory(Default)

    expect(html).toContain('pensjondeployer')
    expect(html).toContain('/team/pensjondeployer/env/prod-fss')
    expect(html).toContain('/team/pensjondeployer/env/prod-gcp')
    expect(html).toContain('applikasjoner')
  })

  it('renders single-environment story without additional environment links', () => {
    const html = renderStory(SingleEnvironment)

    expect(html).toContain('/team/pensjondeployer/env/prod-fss')
    expect(html).not.toContain('/team/pensjondeployer/env/prod-gcp')
    expect(html).toContain('2 applikasjoner')
  })

  it('renders multiple-environment story with sorted environment order and counts', () => {
    const html = renderStory(MultipleEnvironments)
    const expectedOrder = [
      '/team/pensjondeployer/env/dev-fss',
      '/team/pensjondeployer/env/prod-fss',
      '/team/pensjondeployer/env/prod-gcp',
    ]

    const positions = expectedOrder.map((env) => html.indexOf(env))
    expect(positions.every((index) => index !== -1)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html).toContain('1 applikasjon')
    expect(html).toContain('2 applikasjoner')
  })
})
