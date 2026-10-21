import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RepositoryCoverage } from '~/routes/__stories__/Deployments.stories'
import { AppDeploymentsPage, type AppDeploymentsPageProps } from '../AppDeploymentsPage'

function render(props: AppDeploymentsPageProps) {
  const router = createMemoryRouter([{ path: '*', element: <AppDeploymentsPage {...props} /> }], {
    initialEntries: [
      '/team/team-fjord/env/prod-gcp/app/glad-fjord/deployments?view=repository&repositoryStatus=incomplete&status=error&page=2&period=all',
    ],
  })
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

describe('application deployment repository list', () => {
  it.each(['application', 'repository'] as const)(
    'marks only the list switcher as the current page in %s view',
    (view) => {
      const markup = render({ ...RepositoryCoverage.args, view })
      const currentPageLinks = markup.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? []
      expect(currentPageLinks).toHaveLength(1)
      expect(currentPageLinks[0]).toContain(`/deployments?view=${view}&amp;`)
      expect(currentPageLinks[0]).not.toContain('listView=')
    },
  )

  it('shows coverage, locked intervals and missing links without presenting old status as repository approval', () => {
    const markup = render({ ...RepositoryCoverage.args, errorReasons: { 5: 'Gammel appfeil' } })
    expect(markup).toMatch(/<h1\b[^>]*>Deployments – repositoryvurdering<\/h1>/)
    expect(markup).not.toContain('Skrivebeskyttet repositoryvisning')
    expect(markup).toContain('Alle commits dekket: 1')
    expect(markup).toContain('Ufullstendig grunnlag: 1')
    expect(markup).toContain('Mangler leveransekobling: 1')
    expect(markup).toContain('Låst repositoryintervall')
    expect(markup).toContain('Ingen lagret leveransekobling')
    expect(markup).not.toContain('Gammel appfeil')
    expect(markup).toContain('value="incomplete" selected=""')
    expect(markup).not.toContain('value="manually_approved"')
    expect(markup).toContain('page=1&amp;period=all')
    expect(markup).toContain(
      'view=repository&amp;repositoryStatus=incomplete&amp;status=error&amp;page=2&amp;period=all',
    )
    expect(markup).toContain('Glad Fjord')
    expect(markup).toContain('page=2&amp;period=all&amp;listView=repository')
  })

  it('keeps application statuses and filters unchanged when application view is selected', () => {
    const markup = render({ ...RepositoryCoverage.args, view: 'application' })
    expect(markup).toMatch(/<h1\b[^>]*>Deployments – appbasert vurdering<\/h1>/)
    expect(markup).not.toContain('Skrivebeskyttet repositoryvisning')
    expect(markup).not.toContain('Låst repositoryintervall')
    expect(markup).toContain('value="manually_approved"')
    expect(markup).toContain('value="error" selected=""')
    expect(markup).toContain('page=2&amp;period=all&amp;listView=application')
  })
})
