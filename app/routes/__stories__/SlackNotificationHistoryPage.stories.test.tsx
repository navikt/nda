import { composeStories, setProjectAnnotations } from '@storybook/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import preview from '../../../.storybook/preview'
import * as stories from './SlackNotificationHistoryPage.stories'

setProjectAnnotations(preview)

const { Empty, NotificationsDisabled, WithHistory } = composeStories(stories)

describe('SlackNotificationHistoryPage story baseline characterization', () => {
  it('WithHistory story shows both approval and deploy notifications with type tags', () => {
    const html = renderToStaticMarkup(<WithHistory />)

    expect(html).toContain('Meldingshistorikk (2)')
    expect(html).toContain('Godkjenningsvarsel')
    expect(html).toContain('Deployment-varsel')
    expect(html).toContain('approve_deployment')
    expect(html).toContain('Glad Fjord')
  })

  it('Empty story shows the empty state alert instead of a table', () => {
    const html = renderToStaticMarkup(<Empty />)

    expect(html).toContain('Ingen Slack-meldinger er sendt for denne applikasjonen ennå.')
    expect(html).not.toContain('Meldingshistorikk')
  })

  it('NotificationsDisabled story shows the disabled config tag', () => {
    const html = renderToStaticMarkup(<NotificationsDisabled />)

    expect(html).toContain('Deaktivert')
  })
})
