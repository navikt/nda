import { composeStories } from '@storybook/react'
import type { JSX, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import * as stories from './AppDetail.stories'
import { mockAuditReport } from './mock-data'

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')

  return {
    ...actual,
    Form: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <form {...props}>{children}</form>
    ),
  }
})

const { AdminView, Default, DevEnvironment, NoRepository, WithAlerts } = composeStories(stories)

function renderStory(StoryComponent: () => JSX.Element) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StoryComponent />
    </MemoryRouter>,
  )
}

describe('AppDetail story baseline characterization', () => {
  it('renders default app details with statistics, report section and active repository', () => {
    const html = renderStory(Default)

    expect(html).toContain('Statistikk')
    expect(html).toContain('Totalt deployments')
    expect(html).toContain('Leveranserapport')
    expect(html).toContain('Aktivt repository')
    expect(html).toContain('AKTIV')
    expect(html).not.toContain('Administrer')
  })

  it('renders admin actions and pending repository approvals in admin view', () => {
    const html = renderStory(AdminView)

    expect(html).toContain('Administrer')
    expect(html).toContain('Venter godkjenning (1)')
    expect(html).toContain('Godkjenn')
    expect(html).toContain('Avvis')
  })

  it('renders alert details in alert scenario', () => {
    const html = renderStory(WithAlerts)

    expect(html).toContain('Åpne varsler (1)')
    expect(html).toContain('Ukjent repo')
    expect(html).toContain('Forventet:')
    expect(html).toContain('Detektert:')
  })

  it('renders warning when no active repository is configured', () => {
    const html = renderStory(NoRepository)

    expect(html).toContain('Ingen aktivt repository satt for denne applikasjonen')
    expect(html).toContain('Venter godkjenning (1)')
  })

  it('does not render audit report section for dev environment', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DevEnvironment auditReports={[mockAuditReport]} />
      </MemoryRouter>,
    )

    expect(html).toContain('dev-fss')
    expect(html).not.toContain('Leveranserapport')
  })
})
