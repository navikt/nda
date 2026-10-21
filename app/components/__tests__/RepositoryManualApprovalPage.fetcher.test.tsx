import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useFetcher } = vi.hoisted(() => ({ useFetcher: vi.fn() }))
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useFetcher,
}))

import { approvalRepository, approvalReview } from '../__fixtures__/repository-approval'
import { RepositoryManualApprovalHistory } from '../RepositoryManualApprovalHistory'
import { RepositoryManualApprovalPage } from '../RepositoryManualApprovalPage'

const Form = ({ children, ...props }: ComponentProps<'form'>) => <form {...props}>{children}</form>
const props = {
  repository: approvalRepository,
  delivery: { id: 17, base_sha: approvalReview.baseSha, head_sha: approvalReview.headSha, first_deployed_at: null },
  review: approvalReview,
  manualApprovalHistory: [],
}

function render(confirmationData: Record<string, unknown> | undefined, review = approvalReview) {
  useFetcher.mockReturnValueOnce({ Form, data: undefined, state: 'idle' })
  useFetcher.mockReturnValueOnce({ Form, data: confirmationData, state: 'idle' })
  return renderToStaticMarkup(
    <MemoryRouter>
      <RepositoryManualApprovalPage {...props} review={review} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('manual approval fetcher response presentation', () => {
  it('shows preview and single approval action without a separate snapshot post', () => {
    const html = render(undefined)
    expect(html.indexOf('Vurderingsgrunnlag')).toBeLessThan(html.indexOf('approve-repository'))
    expect(html).toContain('name="previewToken"')
    expect(html).toContain('Kommentar (valgfritt)')
    expect(html).not.toContain('snapshotId')
    expect(html).not.toContain('start-review')
  })

  it('shows stale-ground rejection and uses the refreshed read-only preview', () => {
    const refreshed = { ...approvalReview, previewToken: 'b'.repeat(64) }
    const html = render({ error: 'Evidens eller identitet er endret.' }, refreshed)
    expect(html).toContain('Evidens eller identitet er endret.')
    expect(html).toContain(`value="${'b'.repeat(64)}"`)
    expect(html).not.toContain(`value="${'a'.repeat(64)}"`)
  })

  it('only reports registration after server confirmation and hides the form', () => {
    const html = render({ success: 'Godkjenningen er registrert. Deploymentstatus er ikke endret.', registered: true })
    expect(html).toContain('Godkjenningen er registrert. Deploymentstatus er ikke endret.')
    expect(html).toContain('Vurderingsgrunnlag')
    expect(html).not.toContain('approve-repository')
  })

  it('retains the revocation result after revalidation hides the form', () => {
    useFetcher.mockReturnValueOnce({ Form, data: { success: 'Godkjenningen er tilbakekalt.' }, state: 'idle' })
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RepositoryManualApprovalHistory
          repository={approvalRepository}
          canRevoke
          entries={[
            {
              id: 41,
              reviewer: 'Z990003',
              registeredBy: 'Z990003',
              reviewedAt: '2026-10-19T08:00:00Z',
              registeredAt: '2026-10-19T09:00:00Z',
              baseSha: approvalReview.baseSha,
              headSha: approvalReview.headSha,
              commits: [
                {
                  sha: approvalReview.commits[0].sha,
                  authorLogin: 'glad-fjord',
                  authorNavIdent: 'Z990001',
                  status: 'revoked',
                },
              ],
              events: [{ type: 'revoked', actor: 'Z990003', reason: 'Feil grunnlag', at: '2026-10-19T10:00:00Z' }],
            },
          ]}
        />
      </MemoryRouter>,
    )
    expect(html).toContain('Godkjenningen er tilbakekalt.')
    expect(html).toContain('Feil grunnlag')
    expect(html).not.toContain('revoke-approval')
  })
})
