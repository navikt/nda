import { beforeEach, describe, expect, it, vi } from 'vitest'

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }))

vi.mock('../connection.server', () => ({ pool: { query: poolQuery } }))

import { createRepositoryAlert } from '../alerts.server'

describe('createRepositoryAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    poolQuery.mockResolvedValueOnce({
      rows: [{ id: 1, monitored_app_id: 7 }],
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
    const insertQuery = poolQuery.mock.calls[1][0]
    expect(insertQuery).toMatch(
      /idempotency_key_enabled\)\s*SELECT\s+\$1,\s*\$2,\s*\$3,\s*\$4,\s*\$5,\s*\$6,\s*\$7,\s*TRUE/,
    )
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
})
