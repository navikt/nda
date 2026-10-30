import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NaisApplyStatus } from '../$team.env.$env.app.$app.admin/NaisApplyStatus'

describe('Nais Apply sync status', () => {
  it('shows pending initial sync without a settings form', () => {
    const html = renderToStaticMarkup(
      <NaisApplyStatus syncState={{ initialHistorySyncedAt: null, lastSyncedAt: null, hasError: false }} />,
    )

    expect(html).toContain('Første fullstendige historikksynk er ikke fullført ennå.')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<button')
  })

  it('shows errors and the last successful sync', () => {
    const html = renderToStaticMarkup(
      <NaisApplyStatus
        syncState={{
          initialHistorySyncedAt: '2026-10-15T10:00:00.000Z',
          lastSyncedAt: '2026-10-15T10:00:00.000Z',
          hasError: true,
        }}
      />,
    )

    expect(html).toContain('Siste Nais Apply-synk feilet.')
    expect(html).toContain('Sist synkronisert:')
    expect(html).not.toContain('Første fullstendige historikksynk er ikke fullført ennå.')
  })
})
