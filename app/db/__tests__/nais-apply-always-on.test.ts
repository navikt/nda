import { beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }))

vi.mock('../connection.server', () => ({ pool: { query: poolQuery } }))

import { checkAuditReadiness } from '../audit-reports/readiness.server'
import { getDevTeamStatsBatch } from '../dashboard-stats/team-batch-stats.server'
import { getDevTeamSummaryStats, getSectionDashboardStats, getSectionOverallStats } from '../dashboard-stats.server'
import { getDevTeamAppsWithIssues } from '../deployments/home.server'
import { getUnapprovedDeployments } from '../deployments/notifications.server'
import { getAllAlertCounts } from '../monitored-applications.server'

describe('Nais Apply always-on reads', () => {
  beforeEach(() => {
    poolQuery.mockReset().mockResolvedValue({ rows: [] })
  })

  it('includes Apply alerts in all-app badges and issues aggregates', async () => {
    await getAllAlertCounts()
    await getDevTeamAppsWithIssues(['team-a'])

    expect(poolQuery).toHaveBeenCalledTimes(2)
    for (const [query] of poolQuery.mock.calls) {
      expect(query).not.toContain('nais_apply_enabled')
    }
  })

  it('includes Apply deliveries in audit readiness and preserves reminder suppression', async () => {
    const start = new Date('2026-01-01T00:00:00Z')
    const end = new Date('2026-12-31T23:59:59Z')

    await checkAuditReadiness(7, start, end)
    await getUnapprovedDeployments(7)

    expect(poolQuery).toHaveBeenCalledTimes(2)
    expect(poolQuery.mock.calls[0][0]).not.toContain('nais_apply_enabled')
    expect(poolQuery.mock.calls[1][0]).not.toContain('nais_apply_enabled')
    expect(poolQuery.mock.calls[1][0]).toContain('d.slack_notifications_suppressed_at IS NULL')
  })

  it('includes Apply deliveries in section, team and batch dashboard aggregates', async () => {
    await getSectionOverallStats(1)
    await getSectionDashboardStats(1)
    await getDevTeamSummaryStats(['team-a'])
    await getDevTeamSummaryStats(['team-a'], [], undefined, undefined, 1)
    await getDevTeamStatsBatch([1], new Date('2026-01-01T00:00:00Z'))

    expect(poolQuery).toHaveBeenCalledTimes(5)
    for (const [query] of poolQuery.mock.calls) {
      expect(query).not.toContain('nais_apply_enabled')
    }
  })
})
