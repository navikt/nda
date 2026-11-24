import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loader } from '../../routes/sections.$sectionSlug.teams.$devTeamSlug.boards'

const { requireUser, getDevTeamBySlug, getBoardsByDevTeam, getSectionBySlug } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getDevTeamBySlug: vi.fn(),
  getBoardsByDevTeam: vi.fn(),
  getSectionBySlug: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({ requireUser }))
vi.mock('~/db/dev-teams.server', () => ({ getDevTeamBySlug }))
vi.mock('~/db/boards.server', () => ({ getBoardsByDevTeam }))
vi.mock('~/db/sections.server', () => ({ getSectionBySlug }))

const args = {
  request: new Request('http://localhost/sections/pensjon/teams/supplerende-stonad/boards'),
  params: { sectionSlug: 'pensjon', devTeamSlug: 'supplerende-stonad' },
  context: {},
} as Parameters<typeof loader>[0]

describe('team boards loader', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requireUser.mockResolvedValue({ role: 'user' })
    getDevTeamBySlug.mockResolvedValue({ id: 7, name: 'Supplerende stønad', slug: 'supplerende-stonad' })
    getSectionBySlug.mockResolvedValue({ name: 'Pensjon' })
  })

  it('returns all team boards for a regular user in the database period order', async () => {
    const boards = [
      { id: 3, is_active: true, period_start: '2026-09-01' },
      { id: 2, is_active: true, period_start: '2026-05-01' },
      { id: 1, is_active: false, period_start: '2025-01-01' },
    ]
    getBoardsByDevTeam.mockResolvedValue(boards)

    const result = await loader(args)

    expect(requireUser).toHaveBeenCalledWith(args.request)
    expect(getBoardsByDevTeam).toHaveBeenCalledWith(7)
    expect(result.boards).toEqual(boards)
  })

  it('requires authentication before reading any team boards', async () => {
    const forbidden = new Response('Forbidden', { status: 403 })
    requireUser.mockRejectedValue(forbidden)

    await expect(loader(args)).rejects.toBe(forbidden)
    expect(getDevTeamBySlug).not.toHaveBeenCalled()
    expect(getBoardsByDevTeam).not.toHaveBeenCalled()
  })
})
