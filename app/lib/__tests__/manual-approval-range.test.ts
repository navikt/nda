import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/db/application-repositories.server', () => ({ findRepositoryForApp: vi.fn() }))
vi.mock('~/db/verification-diff.server', () => ({ getEffectiveComparisonBaseSha: vi.fn() }))

import { findRepositoryForApp } from '~/db/application-repositories.server'
import { getEffectiveComparisonBaseSha } from '~/db/verification-diff.server'
import { resolveReviewedComparisonRange } from '~/lib/verification/manual-approval-range.server'

const deployment = {
  id: 10,
  monitored_app_id: 20,
  commit_sha: 'head',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'monorepo',
}

function form(baseSha: string, headSha = 'head'): FormData {
  const data = new FormData()
  data.set('comparison_base_sha', baseSha)
  data.set('comparison_head_sha', headSha)
  return data
}

describe('resolveReviewedComparisonRange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findRepositoryForApp).mockResolvedValue({
      repository: { github_repo_id: '9001' },
    } as Awaited<ReturnType<typeof findRepositoryForApp>>)
    vi.mocked(getEffectiveComparisonBaseSha).mockResolvedValue('base')
  })

  it('records the interval displayed to the approver instead of deriving another range', async () => {
    await expect(resolveReviewedComparisonRange(deployment, form('base'))).resolves.toEqual({
      range: { baseSha: 'base', headSha: 'head' },
    })
  })

  it('rejects a stale page when its displayed interval changed before approval', async () => {
    vi.mocked(getEffectiveComparisonBaseSha).mockResolvedValue('changed-base')
    const result = await resolveReviewedComparisonRange(deployment, form('base'))
    expect(result.range).toBeNull()
    expect(result.error).toContain('endret')
  })

  it('preserves a null base as a documented first-deployment interval', async () => {
    vi.mocked(getEffectiveComparisonBaseSha).mockResolvedValue(null)
    await expect(resolveReviewedComparisonRange(deployment, form(''))).resolves.toEqual({
      range: { baseSha: null, headSha: 'head' },
    })
  })

  it('does not synthesize a shareable interval for requests without displayed range data', async () => {
    await expect(resolveReviewedComparisonRange(deployment, new FormData())).resolves.toEqual({ range: null })
    expect(getEffectiveComparisonBaseSha).not.toHaveBeenCalled()
  })

  it('rejects a submitted head that does not belong to the deployment', async () => {
    const result = await resolveReviewedComparisonRange(deployment, form('base', 'other-head'))
    expect(result.error).toContain('Ugyldig')
    expect(getEffectiveComparisonBaseSha).not.toHaveBeenCalled()
  })
})
