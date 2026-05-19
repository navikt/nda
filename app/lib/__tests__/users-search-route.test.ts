import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/auth.server', () => ({
  requireUser: vi.fn(),
}))

vi.mock('~/lib/authorization.server', () => ({
  canSearchUsers: vi.fn(),
}))

vi.mock('~/lib/microsoft-graph.server', () => ({
  searchGraphUsers: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { error: vi.fn() },
}))

import { requireUser } from '~/lib/auth.server'
import { canSearchUsers } from '~/lib/authorization.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import { loader } from '../../routes/api/users.search'

function makeRequest(query = '') {
  const url = new URL(`http://localhost/api/users/search?q=${encodeURIComponent(query)}`)
  return new Request(url.toString())
}

const mockUser = { navIdent: 'A123456', name: 'Glad Fjord', role: 'admin' }

describe('users.search loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue(mockUser as never)
    vi.mocked(canSearchUsers).mockResolvedValue(true)
  })

  it('returns 403 with Cache-Control: no-store when user lacks permission', async () => {
    vi.mocked(canSearchUsers).mockResolvedValue(false)

    const response = await loader({ request: makeRequest('test') } as never)

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.results).toEqual([])
    expect(data.error).toBe('Ingen tilgang')
  })

  it('returns empty results with Cache-Control: no-store for short queries', async () => {
    const response = await loader({ request: makeRequest('a') } as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.results).toEqual([])
  })

  it('returns search results with Cache-Control: no-store', async () => {
    const mockResults = [{ displayName: 'Rask Elv', email: 'rask.elv@nav.no', navIdent: 'B654321' }]
    vi.mocked(searchGraphUsers).mockResolvedValue(mockResults)

    const response = await loader({ request: makeRequest('Rask') } as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.results).toEqual(mockResults)
    expect(searchGraphUsers).toHaveBeenCalledWith('Rask')
  })

  it('returns 500 with Cache-Control: no-store when search fails', async () => {
    vi.mocked(searchGraphUsers).mockRejectedValue(new Error('Graph API error'))

    const response = await loader({ request: makeRequest('test query') } as never)

    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.results).toEqual([])
    expect(data.error).toBe('Søket feilet')
  })

  it('does not call searchGraphUsers when query is too short', async () => {
    await loader({ request: makeRequest('x') } as never)

    expect(searchGraphUsers).not.toHaveBeenCalled()
  })
})
