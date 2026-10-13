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
            previewRepository={null}
            previewDeployments={[]}
            invalidRepository={false}
            returnToTeam={null}
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

  it('shows concrete deployments from every team in the repository-wide preview', () => {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <RepositoryIdBackfillCoverage
              teams={[]}
              selectedTeam={null}
              invalidTeam={false}
              repositories={[]}
              totals={{ legacy: 2, eligible: 1 }}
              previewRepository={{ repositoryId: 216, githubOwner: 'navikt', githubRepoName: 'pensjon-alde' }}
              previewDeployments={[
                {
                  deploymentId: 101,
                  teamSlug: 'pensjondeployer',
                  appName: 'pensjon-alde',
                  environmentName: 'prod-gcp',
                  createdAt: new Date('2026-10-13T12:00:00.000Z'),
                  commitSha: 'a'.repeat(40),
                  workflowRunId: '123',
                  classification: 'eligible',
                },
                {
                  deploymentId: 102,
                  teamSlug: 'pensjon-saksbehandling',
                  appName: 'pensjon-alde',
                  environmentName: 'prod-gcp',
                  createdAt: new Date('2026-10-13T12:01:00.000Z'),
                  commitSha: 'b'.repeat(40),
                  workflowRunId: null,
                  classification: 'no_trigger_url',
                },
              ]}
              invalidRepository={false}
              returnToTeam="pensjondeployer"
            />
          ),
        },
      ],
      { initialEntries: ['/'] },
    )
    const markup = renderToStaticMarkup(<RouterProvider router={router} />)

    expect(markup).toContain('pensjondeployer')
    expect(markup).toContain('pensjon-saksbehandling')
    expect(markup).toContain('Deployment-ID')
    expect(markup).toContain('Mangler workflow-run-lenke')
    expect(markup).toContain('2')
    expect(markup).toContain('1')
  })
})
