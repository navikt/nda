import { beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }))

vi.mock('../connection.server', () => ({ pool: { query: poolQuery } }))

import { createRepositoryAlert, getAlertCountsByApp, getUnresolvedAlertsByApp } from '../alerts.server'

describe('createRepositoryAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValueOnce({
      rows: [{ id: 1 }],
      rowCount: 1,
    })
  })

  it('returns whether a repository alert was inserted', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 22 }], rowCount: 1 })

    const inserted = await createRepositoryAlert({
      monitoredApplicationId: 7,
      deploymentNaisId: 'deployment-1',
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'new-repo',
      expectedGithubOwner: 'navikt',
      expectedGithubRepoName: 'expected-repo',
      alertType: 'pending_approval',
    })

    expect(inserted).toBe(true)
    expect(poolQuery.mock.calls[0][0]).toContain(
      'SELECT id FROM deployments WHERE nais_deployment_id = $1 AND monitored_app_id = $2',
    )
    expect(poolQuery.mock.calls[0][1]).toEqual(['deployment-1', 7])
    const insertQuery = poolQuery.mock.calls[1][0]
    expect(insertQuery).toMatch(/WITH alert_event AS\s*\(\s*SELECT\s+\$1::integer.*\$3::varchar AS alert_type/s)
    expect(insertQuery).not.toMatch(/\$[3-7]::varchar\(\d+\)/)
    expect(insertQuery).toContain('FROM alert_event input_values')
    expect(insertQuery).toContain('WHERE NOT EXISTS')
    expect(insertQuery).toContain('ON CONFLICT DO NOTHING')
  })

  it('returns false when an alert with the same event identity already exists', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })

    const inserted = await createRepositoryAlert({
      monitoredApplicationId: 7,
      deploymentNaisId: 'deployment-1',
      detectedGithubOwner: 'navikt',
      detectedGithubRepoName: 'new-repo',
      expectedGithubOwner: 'navikt',
      expectedGithubRepoName: 'expected-repo',
      alertType: 'pending_approval',
    })

    expect(inserted).toBe(false)
    expect(poolQuery.mock.calls[1][0]).toContain('WHERE NOT EXISTS')
  })

  it('excludes opted-out Apply alerts while retaining alerts without a deployment', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ monitored_app_id: 7, count: '2' }] })

    await getAlertCountsByApp()

    expect(poolQuery.mock.calls[0][0]).toContain('LEFT JOIN deployments d ON d.id = ra.deployment_id')
    expect(poolQuery.mock.calls[0][0]).toContain('JOIN monitored_applications ma ON ma.id = ra.monitored_app_id')
    expect(poolQuery.mock.calls[0][0]).toContain(
      "(d.id IS NULL OR d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)",
    )
  })

  it('excludes Apply alerts from the app alert list when the app has opted out', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })

    await getUnresolvedAlertsByApp(7)

    expect(poolQuery.mock.calls[0][0]).toContain(
      "(d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)",
    )
    expect(poolQuery.mock.calls[0][1]).toEqual([7])
  })
})
