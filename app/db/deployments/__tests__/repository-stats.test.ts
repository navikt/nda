import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  pool: { query: mockPoolQuery },
}))

const { getRepositoryDeploymentStats } = await import('../stats.server')

function mockStatsQueries(
  mainRows: Record<string, unknown>[],
  baselineRows: Record<string, unknown>[],
  lastDeploymentRows: Record<string, unknown>[],
) {
  mockPoolQuery
    .mockResolvedValueOnce({ rows: mainRows })
    .mockResolvedValueOnce({ rows: baselineRows })
    .mockResolvedValueOnce({ rows: lastDeploymentRows })
}

describe('getRepositoryDeploymentStats', () => {
  beforeEach(() => {
    mockPoolQuery.mockReset()
  })

  it('returns zeroed stats without querying the database when there are no linked apps', async () => {
    const result = await getRepositoryDeploymentStats([])

    expect(mockPoolQuery).not.toHaveBeenCalled()
    expect(result).toEqual({
      total: 0,
      with_four_eyes: 0,
      without_four_eyes: 0,
      pending_verification: 0,
      missing_goal_links: 0,
      baseline_action_count: 0,
      last_deployment: null,
      last_deployment_id: null,
      four_eyes_percentage: 0,
    })
  })

  it('sums counters across apps and recomputes the percentage', async () => {
    mockStatsQueries(
      [
        { monitored_app_id: 1, total: '10', with_four_eyes: '8', pending_verification: '1', missing_goal_links: '2' },
        { monitored_app_id: 2, total: '5', with_four_eyes: '1', pending_verification: '0', missing_goal_links: '1' },
      ],
      [
        { monitored_app_id: 1, baseline_action_count: '3' },
        { monitored_app_id: 2, baseline_action_count: '0' },
      ],
      [
        { monitored_app_id: 1, id: 101 },
        { monitored_app_id: 2, id: 202 },
      ],
    )

    const result = await getRepositoryDeploymentStats([
      { id: 1, audit_start_year: 2023 },
      { id: 2, audit_start_year: null },
    ])

    expect(result.total).toBe(15)
    expect(result.with_four_eyes).toBe(9)
    expect(result.without_four_eyes).toBe(5)
    expect(result.pending_verification).toBe(1)
    expect(result.missing_goal_links).toBe(3)
    expect(result.baseline_action_count).toBe(3)
    expect(result.four_eyes_percentage).toBe(Math.round((9 / 15) * 100))
  })

  it('picks the last_deployment_id belonging to the app with the latest last_deployment timestamp', async () => {
    mockStatsQueries(
      [
        {
          monitored_app_id: 1,
          total: '1',
          with_four_eyes: '0',
          pending_verification: '0',
          missing_goal_links: '0',
          last_deployment: '2024-01-01T00:00:00.000Z',
        },
        {
          monitored_app_id: 2,
          total: '1',
          with_four_eyes: '0',
          pending_verification: '0',
          missing_goal_links: '0',
          last_deployment: '2024-06-01T00:00:00.000Z',
        },
      ],
      [],
      [
        { monitored_app_id: 1, id: 101 },
        { monitored_app_id: 2, id: 202 },
      ],
    )

    const result = await getRepositoryDeploymentStats([
      { id: 1, audit_start_year: null },
      { id: 2, audit_start_year: null },
    ])

    expect(result.last_deployment_id).toBe(202)
    expect(result.last_deployment).toEqual(new Date('2024-06-01T00:00:00.000Z'))
  })
})
