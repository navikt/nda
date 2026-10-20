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
  manualApprovalHistory: [],
}

function render(confirmationData: Record<string, unknown> | undefined, headSha = approvalReview.headSha) {
  useFetcher.mockReturnValueOnce({
    Form,
    data: { success: 'Vurderingsgrunnlaget er fryst.', review: approvalReview },
    state: 'idle',
  })
  useFetcher.mockReturnValueOnce({ Form, data: confirmationData, state: 'idle' })
  return renderToStaticMarkup(
    <MemoryRouter>
      <RepositoryManualApprovalPage {...props} delivery={{ ...props.delivery, head_sha: headSha }} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('manual approval fetcher response presentation', () => {
  it('shows the POST-created snapshot before the confirmation action', () => {
    const html = render(undefined)
    expect(html.indexOf('Fryst vurderingsgrunnlag')).toBeLessThan(html.indexOf('register-approval'))
    expect(html).toContain('name="snapshotId" value="23"')
    expect(html).toContain('Start en ny gjennomgang med nytt grunnlag')
  })

  it('retains the stored ground after loader revalidation instead of replacing it with live evidence', () => {
    const html = render({ error: 'Reviewtid er ugyldig.' }, '1'.repeat(40))
    expect(html).toContain('Reviewtid er ugyldig.')
    expect(html).toContain('name="snapshotId" value="23"')
    expect(html).toContain(`compare/${approvalReview.baseSha}...${approvalReview.headSha}`)
    expect(html).not.toContain(`compare/${approvalReview.baseSha}...${'1'.repeat(40)}`)
  })

  it('keeps the displayed snapshot on stale rejection but removes confirmation until an explicit new review', () => {
    const html = render({ error: 'Evidens eller identitet er endret.', stale: true })
    expect(html).toContain('Evidens eller identitet er endret.')
    expect(html).toContain('Fryst vurderingsgrunnlag')
    expect(html).toContain('Start en ny gjennomgang med nytt grunnlag')
    expect(html).toContain('start-review')
    expect(html).not.toContain('register-approval')
  })

  it('only reports registration after server confirmation and prevents resubmitting the same form in the UI', () => {
    const html = render({ success: 'Godkjenningen er registrert. Deploymentstatus er ikke endret.', registered: true })
    expect(html).toContain('Godkjenningen er registrert. Deploymentstatus er ikke endret.')
    expect(html).toContain('Fryst vurderingsgrunnlag')
    expect(html).not.toContain('register-approval')
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
