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
  it.each([
    [null, null],
    ['navikt', null],
    [null, 'glad-fjord'],
  ])('shows repository-dependent details as text when identity is incomplete (%s/%s)', (owner, repo) => {
    const markup = render(
      {
        ...repositoryDeploymentData,
        repository: null,
        link: { state: 'missing', reason: 'missing_repository', unresolvedReason: null, candidate: null },
      },
      undefined,
      {
        ...repositoryDeploymentDetailsData,
        deployment: {
          ...repositoryDeploymentDetailsData.deployment,
          detected_github_owner: owner,
          detected_github_repo_name: repo,
          parent_commits: [{ sha: 'e'.repeat(40) }, { sha: 'f'.repeat(40) }],
        },
      },
    )
    expect(markup.match(/href="https:\/\/github.com\/[^"]*(?:null|undefined)[^"]*"/g) ?? []).toEqual([])
    expect(markup).toContain('ccccccc')
    expect(markup).toContain('eeeeeee')
    expect(markup).toContain('fffffff')
    expect(markup).toContain('main')
    expect(markup).toContain('Kopier SHA')
  })

  it('shows only repository assessment and commits, retaining shared details and view navigation', () => {
    const markup = render(repositoryDeploymentData)
    expect(markup).toContain('Repositorybasert vurdering')
    expect(markup).toContain('Hele intervallet er dekket')
    expect(markup).toContain('Dekket av manuell godkjenning')
    expect(markup).toContain('b'.repeat(40))
    expect(markup).toContain('Rask Elv')
    expect(markup).toContain('glad-fjord-web')
    expect(markup).toContain('feat: Repository delivery')
    expect(markup).toContain('Dekning per commit')
    expect(markup).toContain('Commit SHA')
    expect(markup).toContain('Nais Deployment ID')
    expect(markup).not.toContain('Neste')
    expect(markup).toContain('Endringer i repositoryleveransen')
    expect(markup).toContain(`/compare/${'b'.repeat(40)}...${'c'.repeat(40)}`)
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

  it('shows specific missing PR evidence, separates unresolved commits from missing approval and links admins to diagnostics', () => {
    if (repositoryDeploymentData.link.state !== 'linked') throw new Error('Expected a linked fixture')
    const commits = [
      { sha: 'c'.repeat(40), status: 'unknown' as const, reason: 'unknown_pr_coverage' as const },
      { sha: 'd'.repeat(40), status: 'not_covered' as const, reason: 'missing_approval' as const },
    ]
    const data: DeploymentRepositoryView = {
      ...repositoryDeploymentData,
      link: {
        ...repositoryDeploymentData.link,
        assessment: { status: 'incomplete', totalCommits: 2, listedCommits: 2, omittedCommits: 0, commits },
        commits: commits.map((commit) => ({
          ...commit,
          authorLogin: 'rask-elv',
          pullRequestNumber: 123,
          prReason: commit.status === 'unknown' ? 'missing_pull_request_snapshot' : null,
        })),
        canAccessAdmin: true,
      },
    }
    const markup = render(data)
    expect(markup).toContain('Uavklart grunnlag')
    expect(markup).toContain('0 commits dekket · 1 commits krever godkjenning · 1 commits har uavklart grunnlag')
    expect(markup).toContain('Snapshot av PR, commits eller reviews mangler')
    expect(markup).toContain('Manglende eller utdaterte GitHub-data må hentes inn på nytt')
    expect(markup).toContain('/pull/123')
    expect(markup).toContain('/admin/code-deliveries/7?repositoryId=5')
    expect(render({ ...data, link: { ...data.link, canAccessAdmin: false } })).not.toContain('/admin/code-deliveries/')
  })

  it('explains missing identities without directing the user to manually approve unknown evidence', () => {
    if (repositoryDeploymentData.link.state !== 'linked') throw new Error('Expected a linked fixture')
    const commit = { sha: 'c'.repeat(40), status: 'unknown' as const, reason: 'unknown_commit_author' as const }
    const markup = render({
      ...repositoryDeploymentData,
      link: {
        ...repositoryDeploymentData.link,
        assessment: { status: 'incomplete', totalCommits: 1, listedCommits: 1, omittedCommits: 0, commits: [commit] },
        commits: [{ ...commit, authorLogin: 'rask-elv', pullRequestNumber: null, prReason: null }],
        canApprove: true,
      },
    })
    expect(markup).toContain('Commit author mangler verifisert GitHub-konto eller kobling til NAV-ident')
    expect(markup).toContain('Be en administrator kontrollere GitHub-kontoens kobling til NAV-ident')
    expect(markup).not.toContain('/approvals/')
  })

  it('explains incomplete history even when there are no commit rows to provide a reason', () => {
    if (repositoryDeploymentData.link.state !== 'linked') throw new Error('Expected a linked fixture')
    const markup = render({
      ...repositoryDeploymentData,
      link: {
        ...repositoryDeploymentData.link,
        assessment: { status: 'incomplete', totalCommits: null, listedCommits: 0, omittedCommits: 0, commits: [] },
        commits: [],
      },
    })
    expect(markup).toContain('Totalt antall commits i intervallet er ukjent. Commit-historikken må hentes inn.')
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

  it('leaves application detail rendering on the unchanged page component', () => {
    const router = createMemoryRouter([
      {
        path: '*',
        element: <DeploymentDetailPage loaderData={deploymentDetailsData} />,
      },
    ])
    const markup = renderToStaticMarkup(<RouterProvider router={router} />)
    expect(markup).toContain('Commits i denne leveransen (2)')
    expect(markup).toContain('Endringer siden forrige leveranse')
    expect(markup).toContain('Denne leveransen består av 2 commits, 1 fra bot og 1 fra menneske.')
  })
})
