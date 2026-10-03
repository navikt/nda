import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AppCard, type AppCardData } from '../AppCard'

const app: AppCardData = {
  id: 1,
  team_slug: 'pensjondeployer',
  environment_name: 'prod-fss',
  app_name: 'pensjon-alde-pdf',
  active_repo: 'navikt/pensjon-alde',
  repository_id: 216,
  stats: { total: 1, without_four_eyes: 1, pending_verification: 0 },
  alertCount: 0,
  siblingEnvironments: ['prod-gcp'],
}

describe('AppCard', () => {
  it('links grouped missing-approval counts to repository deployments with period and team filters', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppCard app={app} appendSearchParams="team=mine" />
      </MemoryRouter>,
    )

    expect(markup).toContain(
      'href="/repository/navikt/pensjon-alde/deployments?repositoryId=216&amp;status=not_approved&amp;period=all&amp;page=1&amp;team=mine"',
    )
  })

  it('keeps ungrouped missing-approval counts linked to the app deployments', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppCard app={{ ...app, siblingEnvironments: undefined }} />
      </MemoryRouter>,
    )

    expect(markup).toContain(
      'href="/team/pensjondeployer/env/prod-fss/app/pensjon-alde-pdf/deployments?status=not_approved&amp;period=all"',
    )
  })

  it('does not link grouped cards to a repository when its immutable ID is ambiguous', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppCard app={{ ...app, repository_id: null }} />
      </MemoryRouter>,
    )

    expect(markup).toContain(
      'href="/team/pensjondeployer/env/prod-fss/app/pensjon-alde-pdf/deployments?status=not_approved&amp;period=all&amp;monorepo=true"',
    )
    expect(markup).not.toContain('/repository/navikt/pensjon-alde/deployments')
  })
})
