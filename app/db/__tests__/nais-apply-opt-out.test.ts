import { beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }))

vi.mock('../connection.server', () => ({ pool: { query: poolQuery } }))

import { checkAuditReadiness } from '../audit-reports/readiness.server'
import { getDevTeamStatsBatch } from '../dashboard-stats/team-batch-stats.server'
import { getDevTeamSummaryStats, getSectionDashboardStats, getSectionOverallStats } from '../dashboard-stats.server'
import { getDevTeamAppsWithIssues } from '../deployments/home.server'
import { getUnapprovedDeployments } from '../deployments/notifications.server'
import { getAllAlertCounts } from '../monitored-applications.server'

const applyVisibilityPredicate = "(d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)"

describe('Nais Apply opt-out reads', () => {
  beforeEach(() => {
    poolQuery.mockReset().mockResolvedValue({ rows: [] })
  })

  it('hides Apply alerts from all-app badges and issues aggregates', async () => {
    await getAllAlertCounts()
    await getDevTeamAppsWithIssues(['team-a'])

    expect(poolQuery).toHaveBeenCalledTimes(2)
    expect(poolQuery.mock.calls[0][0]).toContain(applyVisibilityPredicate)
    expect(poolQuery.mock.calls[1][0]).toContain(applyVisibilityPredicate)
  })

  it('excludes opted-out Apply deliveries from audit readiness and scheduled reminders', async () => {
    const start = new Date('2026-01-01T00:00:00Z')
    const end = new Date('2026-12-31T23:59:59Z')

    await checkAuditReadiness(7, start, end)
    await getUnapprovedDeployments(7)

    expect(poolQuery).toHaveBeenCalledTimes(2)
    expect(poolQuery.mock.calls[0][0]).toContain(applyVisibilityPredicate)
    expect(poolQuery.mock.calls[1][0]).toContain(applyVisibilityPredicate)
    expect(poolQuery.mock.calls[1][0]).toContain('d.slack_notifications_suppressed_at IS NULL')
  })

  it('excludes opted-out Apply deliveries from section, team and batch dashboard aggregates', async () => {
    await getSectionOverallStats(1)
    await getSectionDashboardStats(1)
    await getDevTeamSummaryStats(['team-a'])
    await getDevTeamSummaryStats(['team-a'], [], undefined, undefined, 1)
    await getDevTeamStatsBatch([1], new Date('2026-01-01T00:00:00Z'))

    expect(poolQuery).toHaveBeenCalledTimes(5)
    for (const [query] of poolQuery.mock.calls) {
      expect(query).toContain(applyVisibilityPredicate)
    }
  })
})
