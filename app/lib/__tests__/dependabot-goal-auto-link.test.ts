import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

vi.mock('~/db/boards.server', () => ({
  loadDependabotTargets: vi.fn(),
}))

vi.mock('~/db/deployment-goal-links.server', () => ({
  addDeploymentGoalLink: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('~/lib/sync/goal-keyword-helpers.server', () => ({
  findDevTeamsForDeployment: vi.fn(),
  loadBoardKeywords: vi.fn(),
}))

vi.mock('~/lib/goal-keyword-matcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/goal-keyword-matcher')>()
  return {
    ...actual,
    matchCommitKeywords: vi.fn(),
  }
})

vi.mock('~/db/connection.server', () => ({
  pool: { query: vi.fn() },
}))

import { loadDependabotTargets } from '~/db/boards.server'
import { addDeploymentGoalLink } from '~/db/deployment-goal-links.server'
import { findDevTeamsForDeployment } from '~/lib/sync/goal-keyword-helpers.server'
import { autoLinkDependabotGoal } from '~/lib/sync/goal-keyword-sync.server'

const mockFindDevTeams = findDevTeamsForDeployment as Mock
const mockLoadTargets = loadDependabotTargets as Mock
const mockAddLink = addDeploymentGoalLink as Mock

describe('autoLinkDependabotGoal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 when no dev teams found', async () => {
    mockFindDevTeams.mockResolvedValue([])

    const result = await autoLinkDependabotGoal(1, 'team-a', 10, new Date('2026-02-15'))
    expect(result).toBe(0)
    expect(mockLoadTargets).not.toHaveBeenCalled()
  })

  it('returns 0 when no Dependabot targets configured', async () => {
    mockFindDevTeams.mockResolvedValue([{ id: 1, name: 'Team A' }])
    mockLoadTargets.mockResolvedValue([])

    const result = await autoLinkDependabotGoal(1, 'team-a', 10, new Date('2026-02-15'))
    expect(result).toBe(0)
    expect(mockAddLink).not.toHaveBeenCalled()
  })

  it('creates a link when target exists and no duplicate', async () => {
    mockFindDevTeams.mockResolvedValue([{ id: 1, name: 'Team A' }])
    mockLoadTargets.mockResolvedValue([
      {
        boardId: 100,
        objectiveId: 50,
        keyResultId: null,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
      },
    ])
    mockAddLink.mockResolvedValue({ id: 1 })

    const result = await autoLinkDependabotGoal(1, 'team-a', 10, new Date('2026-02-15'))
    expect(result).toBe(1)
    expect(mockAddLink).toHaveBeenCalledWith({
      deployment_id: 1,
      objective_id: 50,
      key_result_id: undefined,
      link_method: 'dependabot_auto',
    })
  })

  it('creates a link to key result when target has keyResultId', async () => {
    mockFindDevTeams.mockResolvedValue([{ id: 1, name: 'Team A' }])
    mockLoadTargets.mockResolvedValue([
      {
        boardId: 100,
        objectiveId: 50,
        keyResultId: 25,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
      },
    ])
    mockAddLink.mockResolvedValue({ id: 1 })

    const result = await autoLinkDependabotGoal(1, 'team-a', 10, new Date('2026-02-15'))
    expect(result).toBe(1)
    expect(mockAddLink).toHaveBeenCalledWith({
      deployment_id: 1,
      objective_id: 50,
      key_result_id: 25,
      link_method: 'dependabot_auto',
    })
  })

  it('returns 0 when link already exists (duplicate check)', async () => {
    mockFindDevTeams.mockResolvedValue([{ id: 1, name: 'Team A' }])
    mockLoadTargets.mockResolvedValue([
      {
        boardId: 100,
        objectiveId: 50,
        keyResultId: null,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-03-31'),
      },
    ])
    mockAddLink.mockResolvedValue(null)

    const result = await autoLinkDependabotGoal(1, 'team-a', 10, new Date('2026-02-15'))
    expect(result).toBe(0)
    expect(mockAddLink).toHaveBeenCalled()
  })

  it('picks the board with the latest periodStart when multiple targets exist', async () => {
    mockFindDevTeams.mockResolvedValue([{ id: 1, name: 'Team A' }])
    mockLoadTargets.mockResolvedValue([
      {
        boardId: 100,
        objectiveId: 50,
        keyResultId: null,
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-06-30'),
      },
      {
        boardId: 200,
        objectiveId: 60,
        keyResultId: null,
        periodStart: new Date('2026-04-01'),
        periodEnd: new Date('2026-06-30'),
      },
    ])
    mockAddLink.mockResolvedValue({ id: 1 })

    const result = await autoLinkDependabotGoal(1, 'team-a', 10, new Date('2026-05-15'))
    expect(result).toBe(1)
    expect(mockAddLink).toHaveBeenCalledWith(expect.objectContaining({ objective_id: 60 }))
  })
})
