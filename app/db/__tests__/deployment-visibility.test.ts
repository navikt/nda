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

describe('Apply deployment visibility', () => {
  beforeEach(() => {
    poolQuery.mockReset().mockResolvedValue({ rows: [{ count: 0 }] })
  })

  it('includes Apply deployments in deployment navigation', async () => {
    await getNextDeployment(1, 7)
    await getPreviousDeploymentForNav(1, 7)

    expect(poolQuery).toHaveBeenCalledTimes(2)
    for (const [query] of poolQuery.mock.calls) {
      expect(query).not.toContain('nais_apply_enabled')
      expect(query).not.toContain('JOIN monitored_applications')
    }
  })

  it('includes Apply deployments in deployer totals and lists', async () => {
    await getDeploymentCountByDeployer('developer')
    await getDeployerMonthlyStats('developer')
    await getDeployerDeploymentsPaginated('developer')
    await getDeployerApps('developer')

    expect(poolQuery).toHaveBeenCalledTimes(5)
    for (const [query] of poolQuery.mock.calls) {
      expect(query).not.toContain('nais_apply_enabled')
    }
  })

  it('includes Apply deployments in verification diff selection and history', async () => {
    await getDeploymentsForDiffComputation(7)
    await getPreviousDeploymentForDiff(1, '12345')
    await getVerificationDiffsForRepository(42, [7])
    await getPreviousDeploymentForNavDiff(1, 7)

    expect(poolQuery).toHaveBeenCalledTimes(4)
    expect(poolQuery.mock.calls[0][0]).not.toContain('nais_apply_enabled')
    expect(poolQuery.mock.calls[1][0]).not.toContain('nais_apply_enabled')
    expect(poolQuery.mock.calls[2][0]).not.toContain('nais_apply_enabled')
    expect(poolQuery.mock.calls[3][0]).not.toContain('nais_apply_enabled')
    expect(poolQuery.mock.calls[3][0]).not.toContain('JOIN monitored_applications')
  })
})
