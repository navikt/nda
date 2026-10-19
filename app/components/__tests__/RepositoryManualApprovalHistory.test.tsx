import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { type ManualApprovalHistoryEntry, RepositoryManualApprovalHistory } from '../RepositoryManualApprovalHistory'

const repository = { githubOwner: 'navikt', githubRepoName: 'glad-fjord' }
const entry: ManualApprovalHistoryEntry = {
  id: 1,
  reviewer: 'Z990003',
  registeredBy: 'Z990003',
  reviewedAt: '2026-10-19T07:00:00Z',
  registeredAt: '2026-10-19T07:10:00Z',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  commits: [{ sha: 'b'.repeat(40), authorLogin: 'glad-fjord', authorNavIdent: 'Z990001', status: 'eligible' }],
  events: [{ type: 'created', actor: 'Z990003', reason: null, at: '2026-10-19T07:10:00Z' }],
}

describe('RepositoryManualApprovalHistory', () => {
  it('shows an explicit empty state', () => {
    const html = renderToStaticMarkup(<RepositoryManualApprovalHistory repository={repository} entries={[]} />)
    expect(html).toContain('Ingen manuelle repositorygodkjenninger er registrert.')
    expect(html).not.toContain('<form')
  })

  it.each([
    { status: 'eligible' as const, label: 'Gyldig identitet og intervall' },
    { status: 'revoked' as const, label: 'Tilbakekalt' },
    { status: 'identity_or_interval_changed' as const, label: 'Identitet eller intervall endret' },
  ])('shows $status without presenting it as an approved delivery', ({ status, label }) => {
    const html = renderToStaticMarkup(
      <RepositoryManualApprovalHistory
        repository={repository}
        entries={[
          {
            ...entry,
            commits: [{ ...entry.commits[0], status }],
            events: [
              ...entry.events,
              { type: 'revoked', actor: 'Z990002', reason: 'Feil grunnlag', at: '2026-10-19T08:00:00Z' },
            ],
          },
        ]}
      />,
    )
    expect(html).toContain(label)
    expect(html).toContain('Z990001')
    expect(html).toContain('glad-fjord')
    expect(html).toContain('Gjennomgått av Z990003')
    expect(html).toContain('Registrert av Z990003')
    expect(html).toContain('Tilbakekalt av Z990002')
    expect(html).toContain('Begrunnelse: Feil grunnlag')
    expect(html).toContain('ikke alene tilstrekkelig')
    expect(html).not.toContain('<form')
  })
})
