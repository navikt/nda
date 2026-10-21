import { describe, expect, it, vi } from 'vitest'
import { getDeploymentsBatch } from '../deployments.server'

describe('deployment batch queries', () => {
  it('reads the first batch without counting or offsetting and retains filters', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    await getDeploymentsBatch(
      {
        monitored_app_ids: [3],
        commit_sha: 'abc',
        start_date: new Date('2026-01-01'),
        goal_filter: 'missing',
        per_app_audit_start_year: true,
      },
      { query },
    )
    expect(query).toHaveBeenCalledOnce()
    const [sql, params] = query.mock.calls[0]
    expect(sql).not.toMatch(/COUNT\(\*\)|OFFSET/i)
    expect(sql).toContain('d.monitored_app_id = ANY($1)')
    expect(sql).toContain('d.commit_sha ILIKE')
    expect(sql).toContain('dgl.deployment_id IS NULL')
    expect(sql).toContain('ORDER BY d.created_at DESC, d.id DESC')
    expect(params.at(-1)).toBe(100)
  })

  it('uses the exact stored timestamp and ID of the previous batch boundary', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    await getDeploymentsBatch({ monitored_app_ids: [3] }, { query }, 42)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('(d.created_at, d.id) < (')
    expect(sql).toContain('SELECT created_at, id FROM deployments WHERE id = $2')
    expect(params).toEqual([[3], 42, 100])
    expect(sql).not.toMatch(/COUNT\(\*\)|OFFSET/i)
  })
})
