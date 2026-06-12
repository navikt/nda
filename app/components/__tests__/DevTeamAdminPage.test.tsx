import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DevTeamAdminPage } from '../DevTeamAdminPage'

vi.mock('react-router', async () => {
  const React = await import('react')
  return {
    Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
      React.createElement('form', props, children),
    Link: ({ children, to, ...props }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to as string, ...props }, children),
  }
})

const baseProps = {
  devTeam: { name: 'Pensjon Team', slug: 'starte-pensjon', nais_team_slugs: ['pensjon-a', 'pensjon-b'] },
  roleMembers: [
    {
      id: 1,
      nav_ident: 'Z990001',
      role: 'utvikler',
      github_username: 'pensjon-dev',
      display_github_username: 'pensjon-dev',
      display_name: 'Rask Elv',
      assigned_at: '2026-01-01T00:00:00Z',
    },
  ],
  linkedApps: [
    {
      monitored_app_id: 42,
      team_slug: 'pensjon-a',
      environment_name: 'prod-gcp',
      app_name: 'pensjon-api',
    },
  ],
  addableApps: [],
  naisCatalogFailed: false,
  boards: [
    {
      id: 1,
      period_type: 'tertiary',
      period_label: 'T1 2026',
      period_start: '2026-01-01',
      period_end: '2026-04-30',
      is_active: true,
    },
  ],
  teamGroups: [],
  ungroupedTeamApps: [],
  teamBasePath: '/sections/pensjon/teams/starte-pensjon',
  isSubmitting: false,
  actionData: { success: 'Lagret' },
}

function renderPage(canAdmin: boolean) {
  return renderToStaticMarkup(<DevTeamAdminPage {...baseProps} canAdmin={canAdmin} />)
}

describe('DevTeamAdminPage', () => {
  it('renders admin sections when user can administer team', () => {
    const html = renderPage(true)

    expect(html).toContain('Administrer Pensjon Team')
    expect(html).toContain('Lagret')
    expect(html).toContain('Tavler')
    expect(html).toContain('Teamnavn')
    expect(html).toContain('Nais-team (2)')
    expect(html).toContain('Applikasjoner (1)')
  })

  it('hides admin-only sections when user only has role access', () => {
    const html = renderPage(false)

    expect(html).toContain('Administrer Pensjon Team')
    expect(html).toContain('Administrer roller for teamet.')
    expect(html).not.toContain('Tavler')
    expect(html).not.toContain('Teamnavn')
    expect(html).not.toContain('Nais-team (2)')
    expect(html).not.toContain('Applikasjoner (1)')
  })
})

describe('ApplicationGroupsTeamSection', () => {
  it('vises for canAdmin og er skjult ellers', () => {
    const withAdmin = renderToStaticMarkup(<DevTeamAdminPage {...baseProps} canAdmin={true} />)
    const withoutAdmin = renderToStaticMarkup(<DevTeamAdminPage {...baseProps} canAdmin={false} />)

    expect(withAdmin).toContain('Applikasjonsgrupper (0)')
    expect(withoutAdmin).not.toContain('Applikasjonsgrupper')
  })

  it('viser "ingen grupper"-melding når det ikke finnes grupper eller forslag', () => {
    const html = renderToStaticMarkup(<DevTeamAdminPage {...baseProps} canAdmin={true} />)
    expect(html).toContain('Ingen applikasjonsgrupper er opprettet')
  })

  it('viser eksisterende gruppe med applikasjoner', () => {
    const html = renderToStaticMarkup(
      <DevTeamAdminPage
        {...baseProps}
        canAdmin={true}
        teamGroups={[
          {
            id: 1,
            name: 'stille-app',
            apps: [
              {
                id: 10,
                team_slug: 'pensjon-a',
                environment_name: 'dev-gcp',
                app_name: 'stille-app',
                is_team_app: true,
              },
              {
                id: 11,
                team_slug: 'pensjon-a',
                environment_name: 'prod-gcp',
                app_name: 'stille-app',
                is_team_app: true,
              },
            ],
          },
        ]}
      />,
    )
    expect(html).toContain('stille-app')
    expect(html).toContain('Applikasjonsgrupper (1)')
    expect(html).toContain('Slett gruppe')
  })

  it('viser "Annet team"-merket for apper som tilhører andre teams', () => {
    const html = renderToStaticMarkup(
      <DevTeamAdminPage
        {...baseProps}
        canAdmin={true}
        teamGroups={[
          {
            id: 2,
            name: 'modig-app',
            apps: [
              {
                id: 20,
                team_slug: 'pensjon-a',
                environment_name: 'prod-gcp',
                app_name: 'modig-app',
                is_team_app: true,
              },
              {
                id: 21,
                team_slug: 'annet-team',
                environment_name: 'prod-fss',
                app_name: 'modig-app',
                is_team_app: false,
              },
            ],
          },
        ]}
      />,
    )
    expect(html).toContain('Annet team')
  })

  it('viser forslag når ugrupperte apper har samme navn i flere miljøer', () => {
    const html = renderToStaticMarkup(
      <DevTeamAdminPage
        {...baseProps}
        canAdmin={true}
        ungroupedTeamApps={[
          { id: 30, team_slug: 'pensjon-a', environment_name: 'dev-gcp', app_name: 'glad-api' },
          { id: 31, team_slug: 'pensjon-a', environment_name: 'prod-gcp', app_name: 'glad-api' },
        ]}
      />,
    )
    expect(html).toContain('Foreslåtte grupper')
    expect(html).toContain('glad-api')
    expect(html).toContain('2 miljøer')
  })
})
