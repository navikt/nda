// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { composeStories, setProjectAnnotations } from '@storybook/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import preview from '../../../.storybook/preview'
import * as stories from './SlackNotificationHistoryPage.stories'

setProjectAnnotations(preview)

const { Empty, NotificationsDisabled, WithConfigChanges, WithHistory } = composeStories(stories)

afterEach(cleanup)

describe('SlackNotificationHistoryPage story baseline characterization', () => {
  it('WithHistory story shows approval, deploy, and reminder notifications with type tags', () => {
    const html = renderToStaticMarkup(<WithHistory />)

    expect(html).toContain('Meldingshistorikk (3)')
    expect(html).toContain('Godkjenningsvarsel')
    expect(html).toContain('Deployment-varsel')
    expect(html).toContain('Purrings-varsel')
    expect(html).toContain('approve_deployment')
    expect(html).toContain('Glad Fjord')
  })

  it('WithConfigChanges story shows config changes and notifications as two separate sections', () => {
    const html = renderToStaticMarkup(<WithConfigChanges />)

    expect(html).toContain('Konfigurasjonsendringer (3)')
    expect(html).toContain('Meldingshistorikk (2)')
    expect(html).toContain('Deployment-varsler deaktivert')
    expect(html).toContain('Deployment-varsler aktivert')
    expect(html).toContain('Deployment-varsler: kanal endret til C0NEWCHAN')
    expect(html).toContain('Rask Elv')

    const configSectionIndex = html.indexOf('Konfigurasjonsendringer (3)')
    const notificationSectionIndex = html.indexOf('Meldingshistorikk (2)')
    expect(configSectionIndex).toBeGreaterThanOrEqual(0)
    expect(notificationSectionIndex).toBeGreaterThan(configSectionIndex)

    const disabledIndex = html.indexOf('Deployment-varsler deaktivert')
    const enabledIndex = html.indexOf('Deployment-varsler aktivert')
    expect(enabledIndex).toBeLessThan(disabledIndex)
  })

  it('Empty story shows the empty state alert instead of a table', () => {
    const html = renderToStaticMarkup(<Empty />)

    expect(html).toContain('Ingen Slack-meldinger er sendt for denne applikasjonen ennå.')
    expect(html).not.toContain('Meldingshistorikk (')
  })

  it('NotificationsDisabled story shows the disabled config tag', () => {
    const html = renderToStaticMarkup(<NotificationsDisabled />)

    expect(html).toContain('Deaktivert')
  })
})

describe('SlackNotificationHistoryPage notification type filter', () => {
  it('filters notifications and config changes by type when a toggle is selected', () => {
    render(<WithConfigChanges />)

    expect(screen.getByText('Meldingshistorikk (2)')).toBeInTheDocument()
    expect(screen.getByText('Konfigurasjonsendringer (3)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Deployment-varsel' }))

    expect(screen.getByText('Meldingshistorikk (1)')).toBeInTheDocument()
    expect(screen.getByText('Konfigurasjonsendringer (3)')).toBeInTheDocument()
    expect(screen.queryAllByText('Godkjenningsvarsel')).toHaveLength(1)

    fireEvent.click(screen.getByRole('radio', { name: 'Godkjenningsvarsel' }))

    expect(screen.getByText('Meldingshistorikk (1)')).toBeInTheDocument()
    expect(screen.queryByText(/Konfigurasjonsendringer/)).not.toBeInTheDocument()
    expect(screen.queryAllByText('Deployment-varsel')).toHaveLength(1)

    fireEvent.click(screen.getByRole('radio', { name: 'Alle' }))

    expect(screen.getByText('Meldingshistorikk (2)')).toBeInTheDocument()
    expect(screen.getByText('Konfigurasjonsendringer (3)')).toBeInTheDocument()
  })
})
