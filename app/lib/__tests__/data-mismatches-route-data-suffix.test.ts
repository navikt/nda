import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ navIdent: 'Z990001', role: 'admin' }),
}))

vi.mock('~/db/connection.server', () => ({
  pool: {
    query: vi.fn((sql: string) => {
      if (sql.includes('AS total_missing')) {
        return Promise.resolve({
          rows: [{ total_missing: 500, with_pr_data: 0, with_unverified_commits: 0, no_fallback: 0 }],
        })
      }
      return Promise.resolve({ rows: [] })
    }),
  },
}))

import { loader } from '../../routes/admin/data-mismatches'

describe('admin/data-mismatches loader pagination redirect (React Router v8 .data suffix)', () => {
  it('redirects to a clamped page without leaking the .data suffix from request.url', async () => {
    let redirectResponse: Response | undefined
    try {
      await loader({
        request: new Request('http://localhost/admin/data-mismatches.data?missingPage=999'),
        url: new URL('http://localhost/admin/data-mismatches?missingPage=999'),
      } as never)
    } catch (thrown) {
      redirectResponse = thrown as Response
    }

    expect(redirectResponse).toBeInstanceOf(Response)
    const location = redirectResponse?.headers.get('Location')
    expect(location).toBe('/admin/data-mismatches?missingPage=10')
    expect(location).not.toContain('.data')
  })
})
