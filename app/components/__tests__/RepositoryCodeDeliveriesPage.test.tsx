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
