import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RepositoryIdBackfillCoverage } from '../RepositoryIdBackfillCoverage'

function renderCoverage(selectedTeam: string | null) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <RepositoryIdBackfillCoverage
            teams={['team-a', 'team-b']}
            selectedTeam={selectedTeam}
            invalidTeam={false}
            repositories={[]}
            totals={{ legacy: selectedTeam ? 12 : 0, eligible: selectedTeam ? 5 : 0 }}
          />
        ),
      },
    ],
    { initialEntries: ['/'] },
  )
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

describe('RepositoryIdBackfillCoverage', () => {
  it('asks for a team without showing global report totals before selection', () => {
    const markup = renderCoverage(null)

    expect(markup).toContain('name="team"')
    expect(markup).toContain('Velg et Nais-team for å hente rapporten.')
    expect(markup).not.toContain('av 0 deployments uten repository-ID')
  })

  it('labels report totals as belonging to the selected team', () => {
    const markup = renderCoverage('team-a')

    expect(markup).toContain('team-a')
    expect(markup).toContain('ikke hele repositoryet på tvers av andre team')
    expect(markup).toContain('5')
    expect(markup).toContain('12')
  })
})
