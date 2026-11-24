import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeamBoardsPage, type TeamBoardsPageProps } from '../TeamBoardsPage'

const props: TeamBoardsPageProps = {
  devTeam: { name: 'Supplerende stønad', slug: 'supplerende-stonad' },
  sectionSlug: 'pensjon',
  boards: [
    {
      id: 3,
      period_label: 'T3 2026',
      period_type: 'tertiary',
      period_start: '2026-09-01',
      period_end: '2026-12-31',
      is_active: true,
    },
    {
      id: 2,
      period_label: 'T2 2026',
      period_type: 'tertiary',
      period_start: '2026-05-01',
      period_end: '2026-08-31',
      is_active: true,
    },
    {
      id: 1,
      period_label: 'T1 2025',
      period_type: 'tertiary',
      period_start: '2025-01-01',
      period_end: '2025-04-30',
      is_active: false,
    },
  ],
}

describe('TeamBoardsPage', () => {
  it('shows current, older active and closed boards with periods, statuses and detail links', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeamBoardsPage {...props} />
      </MemoryRouter>,
    )

    for (const board of props.boards) {
      expect(markup).toContain(board.period_label)
      expect(markup).toContain(`href="/sections/pensjon/teams/supplerende-stonad/${board.id}"`)
      expect(markup).toContain(new Date(board.period_start).toLocaleDateString('nb-NO'))
      expect(markup).toContain(new Date(board.period_end).toLocaleDateString('nb-NO'))
    }
    expect(markup.match(/>Aktiv</g)).toHaveLength(2)
    expect(markup).toContain('>Avsluttet<')
    expect(markup.indexOf('T3 2026')).toBeLessThan(markup.indexOf('T2 2026'))
    expect(markup.indexOf('T2 2026')).toBeLessThan(markup.indexOf('T1 2025'))
  })

  it('shows an empty state and a link back to the team when no boards exist', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeamBoardsPage {...props} boards={[]} />
      </MemoryRouter>,
    )

    expect(markup).toContain('Ingen tavler er opprettet ennå.')
    expect(markup).toContain('href="/sections/pensjon/teams/supplerende-stonad"')
    expect(markup).not.toContain('<table')
  })
})
