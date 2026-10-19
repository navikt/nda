import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { approvalRepository, approvalReview } from '../__fixtures__/repository-approval'
import { RepositoryApprovalDeliveriesPage } from '../RepositoryApprovalDeliveriesPage'
import { RepositoryManualApprovalHistory } from '../RepositoryManualApprovalHistory'
import {
  RepositoryApprovalConfirmation,
  RepositoryApprovalSnapshot,
  RepositoryManualApprovalPage,
} from '../RepositoryManualApprovalPage'

function render(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: '*', element }], {
    initialEntries: ['/repository/navikt/glad-fjord/approvals/17?repositoryId=5'],
  })
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

describe('repository manual approval UI', () => {
  it('has only the POST start action before a snapshot exists, never a registration form', () => {
    const html = render(
      <RepositoryManualApprovalPage
        repository={approvalRepository}
        delivery={{
          id: 17,
          base_sha: approvalReview.baseSha,
          head_sha: approvalReview.headSha,
          first_deployed_at: null,
        }}
        manualApprovalHistory={[]}
      />,
    )
    expect(html).toContain('Start gjennomgang')
    expect(html).toContain('method="post"')
    expect(html).toContain('start-review')
    expect(html).not.toContain('register-approval')
    expect(html).not.toContain('snapshotId')
    expect(html).not.toContain('/admin')
  })

  it('presents saved snapshot details before explicit confirmation, with only eligible commits selectable and none preselected', () => {
    const html = render(
      <>
        <RepositoryApprovalSnapshot repository={approvalRepository} review={approvalReview} />
        <RepositoryApprovalConfirmation review={approvalReview} />
      </>,
    )
    expect(html.indexOf('Fryst vurderingsgrunnlag')).toBeLessThan(html.indexOf('Bekreft gjennomgangen'))
    expect(html).toContain(approvalReview.baseSha)
    expect(html).toContain(approvalReview.headSha)
    expect(html).toContain('Z990003')
    expect(html).toContain('2026-10-17T10:00:00Z')
    expect(html).toContain('Git-metadata er ikke sikkert tidsbevis')
    expect(html).toContain('erstattes ikke automatisk')
    expect(html).toContain('Du kan ikke godkjenne dine egne commits.')
    expect(html).toContain('PR-grunnlaget er ukjent.')
    expect(html).toContain('Forfatteren mangler en aktiv kobling')
    expect(html).toContain('Ingen alternativ tid brukes.')
    expect(html.match(/name="commitShas"/g)).toHaveLength(1)
    expect(html).toContain(`value="${approvalReview.commits[0].sha}"`)
    expect(html).not.toContain('checked=""')
    expect(html).toContain('name="snapshotId" value="23"')
    expect(html).toContain('Hva har du gjennomgått?')
    expect(html).toContain('Faktisk tidspunkt for gjennomgangen')
    expect(html).toContain('med tidssone')
    expect(html).toContain('Lenke til ytterligere dokumentasjon (valgfritt)')
    expect(html).not.toContain('name="reviewer"')
    expect(html).not.toContain('name="registeredBy"')
  })

  it('explains when no commit is selectable', () => {
    const html = render(
      <RepositoryApprovalConfirmation review={{ ...approvalReview, commits: approvalReview.commits.slice(1) }} />,
    )
    expect(html).toContain('Ingen commits kan velges')
    expect(html).not.toContain('name="commitShas"')
  })

  it('shows a restricted delivery entry point with no admin navigation', () => {
    const html = render(
      <RepositoryApprovalDeliveriesPage
        repository={approvalRepository}
        deliveries={[
          { id: 17, baseSha: approvalReview.baseSha, headSha: approvalReview.headSha, firstDeployedAt: null },
        ]}
        page={1}
        hasNextPage
      />,
    )
    expect(html).toContain('/approvals/17?repositoryId=5')
    expect(html).toContain('Ikke deployet')
    expect(html).toContain('page=2')
    expect(html).not.toContain('/admin')
  })

  it('shows subsequent approval, documentation, safe link and the reasoned revoke form only for admins', () => {
    const entry = {
      id: 41,
      reviewer: 'Z990003',
      registeredBy: 'Z990003',
      reviewedAt: '2026-10-19T08:00:00Z',
      registeredAt: '2026-10-19T09:00:00Z',
      baseSha: approvalReview.baseSha,
      headSha: approvalReview.headSha,
      reviewDocumentation: 'Gjennomgått kode og tester.',
      documentationUrl: 'https://example.com/review',
      commits: [
        {
          sha: approvalReview.commits[0].sha,
          authorLogin: 'glad-fjord',
          authorNavIdent: 'Z990001',
          status: 'eligible' as const,
        },
      ],
      events: [{ type: 'created' as const, actor: 'Z990003', reason: null, at: '2026-10-19T09:00:00Z' }],
    }
    const props = { repository: approvalRepository, entries: [entry], firstDeployedAt: '2026-10-18T08:00:00Z' }
    const html = render(<RepositoryManualApprovalHistory {...props} canRevoke />)
    expect(html).toContain('Etterfølgende godkjenning')
    expect(html).toContain('Registrert etter første deploy')
    expect(html).toContain('ikke godkjent ved første deploy')
    expect(html).toContain('Gjennomgått kode og tester.')
    expect(html).toContain('https://example.com/review')
    expect(html).toContain('noopener')
    expect(html).toContain('Begrunnelse for tilbakekalling')
    expect(html).toContain('revoke-approval')
    expect(render(<RepositoryManualApprovalHistory {...props} />)).not.toContain('revoke-approval')
    const registeredLater = render(
      <RepositoryManualApprovalHistory
        {...props}
        entries={[
          {
            ...entry,
            reviewedAt: '2026-10-17T08:00:00Z',
          },
        ]}
      />,
    )
    expect(registeredLater).toContain('Registrert etter første deploy')
    expect(registeredLater).not.toContain('Etterfølgende godkjenning')
    const registeredBefore = render(
      <RepositoryManualApprovalHistory
        {...props}
        entries={[
          {
            ...entry,
            reviewedAt: '2026-10-17T08:00:00Z',
            registeredAt: '2026-10-17T09:00:00Z',
          },
        ]}
      />,
    )
    expect(registeredBefore).not.toContain('Registrert etter første deploy')
    expect(
      render(
        <RepositoryManualApprovalHistory
          {...props}
          entries={[
            {
              ...entry,
              events: [
                ...entry.events,
                { type: 'revoked', actor: 'Z990002', reason: 'Feil grunnlag', at: '2026-10-19T10:00:00Z' },
              ],
            },
          ]}
          canRevoke
        />,
      ),
    ).not.toContain('revoke-approval')
  })
})
