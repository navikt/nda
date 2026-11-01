import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it } from 'vitest'
import { BlandetOppfolging } from '~/routes/__stories__/RepositoryCodeDeliveries.stories'
import { RepositoryCodeDeliveriesPage, type RepositoryCodeDeliveriesPageProps } from '../RepositoryCodeDeliveriesPage'

function renderPage(canApprove: boolean, deliveries?: RepositoryCodeDeliveriesPageProps['deliveries']) {
  const args = BlandetOppfolging.args as RepositoryCodeDeliveriesPageProps
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <RepositoryCodeDeliveriesPage
          {...args}
          status="all"
          canApprove={canApprove}
          deliveries={deliveries ?? args.deliveries}
        />
      ),
    },
  ])
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

it('shows distinct follow-up statuses and actions before the collapsed historical diagnostics', () => {
  const markup = renderPage(true)
  expect(markup).toContain('Trenger manuell godkjenning')
  expect(markup).toContain('Godkjenn 2 commits')
  expect(markup).toContain('/approvals/4?repositoryId=5')
  expect(markup).toContain('Ufullstendig grunnlag')
  expect(markup).toContain('Undersøk grunnlaget')
  expect(markup).toContain('Alle commits dekket')
  expect(markup).toContain('Anker – ingen kodeendringer')
  expect(markup).toContain('name="status"')
  expect(markup).toContain('value="not_approved"')
  expect(markup).toContain('value="incomplete"')
  expect(markup.indexOf('Godkjenn 2 commits')).toBeLessThan(markup.indexOf('Grunnlag for historisk innlesing'))
})

it('does not offer approval actions to an admin without approval rights', () => {
  const markup = renderPage(false)
  expect(markup).not.toContain('Godkjenn 2 commits')
  expect(markup).not.toContain('/approvals/')
  expect(markup).toContain('Trenger manuell godkjenning')
  expect(markup).toContain('Vis detaljer')
})

it('explains an empty filter separately from an empty repository', () => {
  expect(renderPage(true, [])).toContain('Ingen leveranser passer til filteret.')
})

it('uses the selected repository for unresolved commit links even when the detected name was reused', () => {
  const args = BlandetOppfolging.args as RepositoryCodeDeliveriesPageProps
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <RepositoryCodeDeliveriesPage
          {...args}
          unresolved={[
            {
              deployment_id: 99,
              team_slug: 'team-fjord',
              environment_name: 'prod-gcp',
              app_name: 'glad-fjord',
              commit_sha: 'f'.repeat(40),
              detected_github_owner: 'navikt',
              detected_github_repo_name: 'reused-name',
              deployed_at: '2024-01-01T00:00:00Z',
              reason: 'source_unknown',
              first_seen_at: '2024-01-01T00:00:00Z',
              last_attempt_at: '2024-01-01T00:00:00Z',
            },
          ]}
        />
      ),
    },
  ])
  const markup = renderToStaticMarkup(<RouterProvider router={router} />)
  expect(markup).toContain(`https://github.com/navikt/glad-fjord/commit/${'f'.repeat(40)}`)
  expect(markup).not.toContain('https://github.com/navikt/reused-name/commit/')
})
