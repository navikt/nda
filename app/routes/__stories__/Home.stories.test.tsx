import { composeStories } from '@storybook/react'
import type { JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import * as stories from './Home.stories'

const { AllAppsOk, HighCoverage, LowCoverage, MultipleTeams, NoTeamSelected, WithTeamsSelected } =
  composeStories(stories)

function renderStory(StoryComponent: () => JSX.Element) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StoryComponent />
    </MemoryRouter>,
  )
}

describe('Home story baseline characterization', () => {
  it('renders selected-team view with stats and action links', () => {
    const html = renderStory(WithTeamsSelected)

    expect(html).toContain('Fireøyne-dekning')
    expect(html).toContain('Motta pensjon')
    expect(html).toContain('Alle applikasjoner (pensjondeployer)')
    expect(html).toContain('Motta pensjon — Tavler')
  })

  it('renders no-team-selected info with profile action', () => {
    const html = renderStory(NoTeamSelected)

    expect(html).toContain('Du har ikke valgt noen utviklingsteam ennå.')
    expect(html).toContain('Min profil')
  })

  it('renders all-apps-ok success message when issue list is empty', () => {
    const html = renderStory(AllAppsOk)

    expect(html).toContain('Alle applikasjoner er i orden — ingen krever oppfølging.')
  })

  it('renders high coverage badge for high coverage scenario', () => {
    const html = renderStory(HighCoverage)

    expect(html).toContain('98%')
    expect(html).toContain('OK')
  })

  it('renders critical badge and issue count for low coverage scenario', () => {
    const html = renderStory(LowCoverage)

    expect(html).toContain('65%')
    expect(html).toContain('Kritisk')
    expect(html).toContain('Applikasjoner som trenger oppfølging (3)')
  })

  it('renders multiple team chips in multiple-team scenario', () => {
    const html = renderStory(MultipleTeams)

    expect(html).toContain('Motta pensjon')
    expect(html).toContain('Beregne pensjon')
  })
})
