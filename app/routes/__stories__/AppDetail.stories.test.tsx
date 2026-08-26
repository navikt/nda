import { composeStories } from '@storybook/react'
import type { JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as stories from './AppDetail.stories'

const { AdminView, Default, DevEnvironment, NoRepository, WithAlerts, WithBaselineWarning } = composeStories(stories)

function renderStory(StoryComponent: () => JSX.Element) {
  return renderToStaticMarkup(<StoryComponent />)
}

describe('AppDetail story baseline characterization', () => {
  it('renders default app details with sync status, statistics, report section and repository sections', () => {
    const html = renderStory(Default)

    expect(html).toContain('Sist synkronisert:')
    expect(html).toContain('Statistikk')
    expect(html).toContain('Totalt deployments')
    expect(html).toContain('Leveranserapport')
    expect(html).toContain('Aktivt repository')
    expect(html).toContain('Historiske repositories (1)')
    expect(html).toContain('Utviklingsteam:')
    expect(html).toContain('Administrer')
    expect(html).toContain('aksel-button--disabled')
    expect(html).not.toContain('Se sync-jobber')
  })

  it('renders admin actions, sync job link and pending repository approvals in admin view', () => {
    const html = renderStory(AdminView)

    expect(html).toContain('Administrer')
    expect(html).toContain('Se sync-jobber')
    expect(html).toContain('Venter godkjenning (1)')
    expect(html).toContain('Godkjenn som aktiv')
    expect(html).toContain('Godkjenn som historisk')
    expect(html).toContain('Avvis')
  })

  it('renders alert details and resolve action in alert scenario', () => {
    const html = renderStory(WithAlerts)

    expect(html).toContain('Åpne varsler (1)')
    expect(html).toContain('Ukjent repo')
    expect(html).toContain('Forventet:')
    expect(html).toContain('Detektert:')
    expect(html).toContain('Se deployment')
    expect(html).toContain('Løs')
  })

  it('renders warning when no active repository is configured', () => {
    const html = renderStory(NoRepository)

    expect(html).toContain('Ingen aktivt repository satt for denne applikasjonen')
    expect(html).toContain('Venter godkjenning (1)')
    expect(html).not.toContain('Historiske repositories')
  })

  it('does not render audit report section for dev environment', () => {
    const html = renderStory(DevEnvironment)

    expect(html).toContain('dev-fss')
    expect(html).not.toContain('Leveranserapport')
  })

  it('renders baseline warning when baseline action count is present', () => {
    const html = renderStory(WithBaselineWarning)

    expect(html).toContain('En deployment trenger baseline-godkjenning.')
  })
})
