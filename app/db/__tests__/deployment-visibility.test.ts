import { beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }))

vi.mock('../connection.server', () => ({ pool: { query: poolQuery } }))

import {
  getDeployerApps,
  getDeployerDeploymentsPaginated,
  getDeployerMonthlyStats,
  getDeploymentCountByDeployer,
} from '../deployer-stats.server'
import {
  getNextDeployment,
  getPreviousDeploymentForNav,
  getPreviousDeploymentForDiff as getPreviousDeploymentForNavDiff,
} from '../deployments/navigation.server'
import {
  getDeploymentsForDiffComputation,
  getPreviousDeploymentForDiff,
  getVerificationDiffsForRepository,
} from '../verification-diff.server'

const applyVisibilityPredicate = "(d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)"

describe('Apply opt-out deployment visibility', () => {
  beforeEach(() => {
    poolQuery.mockReset().mockResolvedValue({ rows: [{ count: 0 }] })
  })

  it('excludes opted-out Apply deployments from deployment navigation', async () => {
    await getNextDeployment(1, 7)
    await getPreviousDeploymentForNav(1, 7)

    expect(poolQuery).toHaveBeenCalledTimes(2)
    for (const [query] of poolQuery.mock.calls) {
      expect(query).toContain("(nav_dep.deployment_source != 'nais_apply' OR nav_app.nais_apply_enabled = true)")
    }
  })

  it('excludes opted-out Apply deployments from deployer totals and lists', async () => {
    await getDeploymentCountByDeployer('developer')
    await getDeployerMonthlyStats('developer')
    await getDeployerDeploymentsPaginated('developer')
    await getDeployerApps('developer')

    expect(poolQuery).toHaveBeenCalledTimes(5)
    for (const [query] of poolQuery.mock.calls) {
      expect(query).toContain(applyVisibilityPredicate)
    }
  })

  it('excludes opted-out Apply deployments from verification diff selection and history', async () => {
    await getDeploymentsForDiffComputation(7)
    await getPreviousDeploymentForDiff(1, '12345')
    await getVerificationDiffsForRepository(42, [7])
    await getPreviousDeploymentForNavDiff(1, 7)

    expect(poolQuery).toHaveBeenCalledTimes(4)
    expect(poolQuery.mock.calls[0][0]).toContain(applyVisibilityPredicate)
    expect(poolQuery.mock.calls[1][0]).toContain(applyVisibilityPredicate)
    expect(poolQuery.mock.calls[2][0]).toContain(applyVisibilityPredicate)
    expect(poolQuery.mock.calls[3][0]).toContain(
      "(prev.deployment_source != 'nais_apply' OR prev_app.nais_apply_enabled = true)",
    )
  })
})
