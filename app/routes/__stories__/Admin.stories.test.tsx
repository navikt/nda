import { composeStories } from '@storybook/react'
import type { JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import * as stories from './Admin.stories'

const { Default, WithPendingVerifications } = composeStories(stories)

function renderStory(StoryComponent: () => JSX.Element) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StoryComponent />
    </MemoryRouter>,
  )
}

describe('Admin story baseline characterization', () => {
  it('renders admin entry points when there are no pending verifications', () => {
    const html = renderStory(Default)

    expect(html).toContain('Administrasjon')
    expect(html).toContain('/deployments/verify')
    expect(html).toContain('/admin/audit-reports')
    expect(html).toContain('/admin/users')
    expect(html).toContain('/admin/sync-jobs')
    expect(html).toContain('/admin/slack')
    expect(html).toContain('Verifiser deployments mot GitHub.')
    expect(html).not.toContain('deployments venter på verifisering.')
  })

  it('renders pending verification messaging when pending deployments exist', () => {
    const html = renderStory(WithPendingVerifications)

    expect(html).toContain('5 deployments venter på verifisering.')
    expect(html).toContain('GitHub-verifisering')
  })
})
