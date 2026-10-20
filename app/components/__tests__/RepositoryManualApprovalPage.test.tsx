// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render as renderInDom, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemoryRouter, RouterProvider, useLoaderData } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { approvalRepository, approvalReview } from '../__fixtures__/repository-approval'
import { RepositoryApprovalDeliveriesPage } from '../RepositoryApprovalDeliveriesPage'
import { RepositoryManualApprovalHistory } from '../RepositoryManualApprovalHistory'
import {
  RepositoryApprovalConfirmation,
  RepositoryApprovalSnapshot,
  RepositoryManualApprovalPage,
  type RepositoryManualApprovalPageProps,
} from '../RepositoryManualApprovalPage'

function render(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: '*', element }], {
    initialEntries: ['/repository/navikt/glad-fjord/approvals/17?repositoryId=5'],
  })
  return renderToStaticMarkup(<RouterProvider router={router} />)
}

describe('repository manual approval UI', () => {
  it('shows the read-only assessment and one approve action without a separate start step', () => {
    const html = render(
      <RepositoryManualApprovalPage
        repository={approvalRepository}
        delivery={{
          id: 17,
          base_sha: approvalReview.baseSha,
          head_sha: approvalReview.headSha,
          first_deployed_at: null,
        }}
        review={approvalReview}
        manualApprovalHistory={[]}
      />,
    )
    expect(html).toContain('Vurderingsgrunnlag')
    expect(html).toContain('method="post"')
    expect(html).toContain('approve-repository')
    expect(html).toContain('Godkjenn manuelt')
    expect(html).toContain('Kommentar (valgfritt)')
    expect(html).not.toContain('Start gjennomgang')
    expect(html).not.toContain('snapshotId')
    expect(html).not.toContain('reviewedAt')
    expect(html).not.toContain('/admin')
  })

  it('explains history anchors instead of offering a review', () => {
    const html = render(
      <RepositoryManualApprovalPage
        repository={approvalRepository}
        delivery={{
          id: 17,
          base_sha: approvalReview.headSha.toUpperCase(),
          head_sha: approvalReview.headSha,
          first_deployed_at: null,
        }}
        review={null}
        manualApprovalHistory={[]}
      />,
    )
    expect(html).toContain('startpunktet for repositoryhistorikken')
    expect(html).not.toContain('start-review')
    expect(html).not.toContain('register-approval')
  })

  it('explains when the assessment is unavailable while preserving approval history', () => {
    const html = render(
      <RepositoryManualApprovalPage
        repository={approvalRepository}
        delivery={{
          id: 17,
          base_sha: approvalReview.baseSha,
          head_sha: approvalReview.headSha,
          first_deployed_at: null,
        }}
        review={null}
        manualApprovalHistory={[]}
      />,
    )
    expect(html).toContain('Vurderingsgrunnlaget er ufullstendig')
    expect(html).toContain('tidligere godkjenninger vises')
  })

  it('preserves the stale action error when revalidation changes the preview token', async () => {
    let loaderCalls = 0
    const initialData = {
      repository: approvalRepository,
      delivery: {
        id: 17,
        base_sha: approvalReview.baseSha,
        head_sha: approvalReview.headSha,
        first_deployed_at: null,
      },
      review: approvalReview,
      manualApprovalHistory: [],
    } satisfies RepositoryManualApprovalPageProps
    const router = createMemoryRouter(
      [
        {
          path: '/',
          loader: () => {
            loaderCalls += 1
            return {
              ...initialData,
              review: {
                ...approvalReview,
                previewToken: loaderCalls > 1 ? 'e'.repeat(64) : approvalReview.previewToken,
              },
            }
          },
          action: vi.fn(() => ({ error: 'Evidens eller identitet er endret.', stale: true })),
          Component() {
            return <RepositoryManualApprovalPage {...useLoaderData<RepositoryManualApprovalPageProps>()} />
          },
        },
      ],
      { initialEntries: ['/'] },
    )
    renderInDom(<RouterProvider router={router} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Godkjenn manuelt' }))
    expect(await screen.findByText('Evidens eller identitet er endret.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByDisplayValue('e'.repeat(64))).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Godkjenn manuelt' })).toBeInTheDocument()
  })

  it('shows PR coverage and only offers manual approval for known uncovered commits', () => {
    const html = render(
      <>
        <RepositoryApprovalSnapshot repository={approvalRepository} review={approvalReview} />
        <RepositoryApprovalConfirmation review={approvalReview} />
      </>,
    )
    expect(html.indexOf('Vurderingsgrunnlag')).toBeLessThan(html.indexOf('Godkjenn manuelt'))
    expect(html).toContain(approvalReview.baseSha)
    expect(html).toContain(approvalReview.headSha)
    expect(html).toContain('Z990003')
    expect(html).toContain('2026-10-17T10:00:00Z')
    expect(html).toContain('Grunnlaget er en forhåndsvisning')
    expect(html).toContain('Du kan ikke godkjenne dine egne commits.')
    expect(html).toContain('PR-grunnlaget er ukjent.')
    expect(html).toContain('Forfatteren mangler en aktiv kobling')
    expect(html).toContain('Kan godkjennes manuelt')
    expect(html).toContain('name="previewToken"')
    expect(html).not.toContain('name="commitShas"')
    expect(html).not.toContain('name="reviewedAt"')
  })

  it('does not offer manual approval for PR-covered or unknown commits', () => {
    const review = {
      ...approvalReview,
      commits: approvalReview.commits.slice(1, 3).map((commit) => ({ ...commit, prStatus: 'covered' as const })),
    }
    const html = render(<RepositoryApprovalConfirmation review={review} />)
    expect(html).toContain('Ingen commits mangler kjent PR-dekning')
    expect(html).not.toContain('approve-repository')
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

  it('shows subsequent approval, comment and the reasoned revoke form only for admins', () => {
    const entry = {
      id: 41,
      reviewer: 'Z990003',
      registeredBy: 'Z990003',
      reviewedAt: '2026-10-19T08:00:00Z',
      registeredAt: '2026-10-19T09:00:00Z',
      baseSha: approvalReview.baseSha,
      headSha: approvalReview.headSha,
      reviewDocumentation: 'Gjennomgått kode og tester.',
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
    expect(html).not.toContain('Ytterligere dokumentasjon')
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
