import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { DeploymentDetailPage } from '~/components/DeploymentDetailPage'
import type { DeploymentRepositoryView } from '~/db/deployment-repository-view.server'
import { deploymentViewUrl } from '~/lib/deployment-view'
import { deploymentDetailsData } from '~/routes/__stories__/DeploymentDetail.stories'
import {
  repositoryDeploymentData,
  repositoryDeploymentDetailsData,
} from '~/routes/__stories__/DeploymentRepository.stories'
import { DeploymentRepositoryPage } from '../DeploymentRepositoryPage'
import { DeploymentViewLinks } from '../deployments/DeploymentViewLinks'

function render(
  data: DeploymentRepositoryView,
  listView?: string,
  deploymentDetails = repositoryDeploymentDetailsData,
) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <DeploymentRepositoryPage data={data} deploymentDetails={deploymentDetails} />,
      },
    ],
    {
      initialEntries: [
        `/deployment?view=repository&period=all&page=2&status=not_approved${listView ? `&listView=${listView}` : ''}`,
      ],
    },
  )
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

describe('repository deployment comparison', () => {
  it('shows both intervals, current coverage and its time limitation without app mutation forms', () => {
    const markup = render(repositoryDeploymentData)
    expect(markup).toContain('Applikasjonsbasert vurdering')
    expect(markup).toContain('Hele intervallet er dekket')
    expect(markup).toContain('ikke ved deploymenttidspunktet')
    expect(markup).toContain('Dekket av manuell godkjenning')
    expect(markup).toContain('a'.repeat(40))
    expect(markup).toContain('b'.repeat(40))
    expect(markup).toContain('Rask Elv')
    expect(markup).toContain('glad-fjord-web')
    expect(markup).toContain('feat: Repository delivery')
    expect(markup).toContain('Commits i applikasjonsintervallet (2)')
    expect(markup).toContain('Commit SHA')
    expect(markup).toContain('Nais Deployment ID')
    expect(markup).not.toContain('Neste')
    expect(markup).toContain('Disse committene hører til intervallet for applikasjonsvurderingen ovenfor.')
    expect(markup).toContain('Intervall fra siste verifiseringskjøring')
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('Godkjenn manuelt')
    expect(markup).toContain('view=application&amp;period=all&amp;page=2&amp;status=not_approved')
    expect(markup).toContain(
      '/team/team-fjord/env/prod-gcp/app/glad-fjord-api/deployments?view=application&amp;period=all&amp;page=2&amp;status=not_approved',
    )
  })

  it.each(['application', 'repository'])(
    'returns to the original %s list, independently of the detail view',
    (listView) => {
      expect(render(repositoryDeploymentData, listView)).toContain(
        `/team/team-fjord/env/prod-gcp/app/glad-fjord-api/deployments?view=${listView}&amp;period=all&amp;page=2&amp;status=not_approved"`,
      )
    },
  )

  it('does not use an exact head match as coverage when the stored link is missing', () => {
    const markup = render({
      ...repositoryDeploymentData,
      link: {
        state: 'missing',
        reason: 'unlinked',
        unresolvedReason: null,
        candidate: { id: 7, baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40) },
      },
    })
    expect(markup).toContain('Ingen tilknyttet repositoryleveranse')
    expect(markup).toContain('Årsaken er ikke avklart')
    expect(markup).toContain('Den brukes derfor ikke som vurderingsgrunnlag')
    expect(markup).not.toContain('Hele intervallet er dekket')
    expect(markup).not.toContain('/approvals/')
  })

  it('shows missing application assessment independently of available repository coverage', () => {
    const markup = render({
      ...repositoryDeploymentData,
      application: { status: null, verificationRunAt: null, range: null },
    })
    expect(markup).toContain('Applikasjonsbasert status mangler')
    expect(markup).toContain('Ingen applikasjonsbasert verifiseringskjøring er lagret')
    expect(markup).toContain('Hele intervallet er dekket')
  })

  it('offers a separate repository approval link only for known missing coverage and sufficient rights', () => {
    if (repositoryDeploymentData.link.state !== 'linked') throw new Error('Expected a linked fixture')
    const data: DeploymentRepositoryView = {
      ...repositoryDeploymentData,
      link: {
        ...repositoryDeploymentData.link,
        canApprove: true,
        assessment: { ...repositoryDeploymentData.link.assessment, status: 'not_approved' },
      },
    }
    expect(render(data)).toContain('/approvals/7?repositoryId=5')
    if (data.link.state !== 'linked') throw new Error('Expected a linked fixture')
    expect(render({ ...data, link: { ...data.link, canApprove: false } })).not.toContain('/approvals/')
    expect(
      render({ ...data, link: { ...data.link, assessment: { ...data.link.assessment, status: 'incomplete' } } }),
    ).not.toContain('/approvals/')
  })

  it('keeps both links on the same deployment and preserves filters without mutating the original params', () => {
    const params = new URLSearchParams('period=last-week&page=3&view=repository')
    const pathname = '/team/team-fjord/env/prod-gcp/app/glad-fjord/deployments/42'
    const router = createMemoryRouter([
      { path: '*', element: <DeploymentViewLinks pathname={pathname} searchParams={params} /> },
    ])
    const markup = renderToStaticMarkup(<RouterProvider router={router} />)
    expect(markup).toContain(`${pathname}?period=last-week&amp;page=3&amp;view=application`)
    expect(markup).toContain(`${pathname}?period=last-week&amp;page=3&amp;view=repository`)
    expect(deploymentViewUrl(pathname, params, 'application')).toContain('view=application')
    expect(params.get('view')).toBe('repository')
  })

  it('does not show the application commit list when the interval head differs from the deployment', () => {
    const markup = render(repositoryDeploymentData)
    const unmatchedData: DeploymentRepositoryView = {
      ...repositoryDeploymentData,
      application: {
        ...repositoryDeploymentData.application,
        range: { baseSha: 'a'.repeat(40), headSha: 'd'.repeat(40) },
      },
    }
    const router = createMemoryRouter([
      {
        path: '*',
        element: <DeploymentRepositoryPage data={unmatchedData} deploymentDetails={repositoryDeploymentDetailsData} />,
      },
    ])
    const unmatchedMarkup = renderToStaticMarkup(<RouterProvider router={router} />)
    expect(markup).toContain('Commits i applikasjonsintervallet')
    expect(unmatchedMarkup).not.toContain('Commits i applikasjonsintervallet')
  })

  it('leaves application detail rendering on the unchanged page component', () => {
    const router = createMemoryRouter([
      {
        path: '*',
        element: <DeploymentDetailPage loaderData={deploymentDetailsData} />,
      },
    ])
    const markup = renderToStaticMarkup(<RouterProvider router={router} />)
    expect(markup).toContain('Commits i denne leveransen (2)')
    expect(markup).not.toContain('Commits i applikasjonsintervallet')
    expect(markup).toContain('Endringer siden forrige leveranse')
    expect(markup).toContain('Denne leveransen består av 2 commits, 1 fra bot og 1 fra menneske.')
  })
})
