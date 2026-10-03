import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getLatestVerificationRun, saveVerificationRun } from '~/db/github-data.server'
import { propagateVerificationToSiblings } from '~/db/monorepo.server'
import {
  getEffectiveComparisonBaseSha,
  getMonorepoComparisonBase,
  getPreviousDeploymentForDiff,
} from '~/db/verification-diff.server'
import { APPROVED_STATUSES } from '~/lib/four-eyes-status'
import { getCommitAncestryStatus } from '~/lib/github'
import {
  findRootApprovedSiblingForCommit,
  getPreviousDeployment,
} from '~/lib/verification/fetch-data/previous-deployment.server'
import { resolveReviewedComparisonRange } from '~/lib/verification/manual-approval-range.server'
import {
  seedApp,
  seedApplicationRepository,
  seedDeployment as seedUnrecordedDeployment,
  truncateAllTables,
} from './helpers'
import { seedDeploymentWithVerification as seedDeployment } from './verification-fixtures'

let pool: Pool

vi.mock('~/lib/github', () => ({
  getCommitAncestryStatus: vi.fn().mockResolvedValue('identical'),
  getGitHubRateLimitRemaining: vi.fn().mockReturnValue(null),
}))

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  vi.mocked(getCommitAncestryStatus).mockReset().mockResolvedValue('identical')
  await truncateAllTables(pool)
})

describe('findRootApprovedSiblingForCommit', () => {
  async function linkedApp(appName: string): Promise<number> {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName, environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9001',
    })
    return appId
  }

  function deployment(appId: number, commitSha: string, day: number, fourEyesStatus = 'pending'): Promise<number> {
    return seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha,
      createdAt: new Date(Date.UTC(2026, 0, day, 10)),
      fourEyesStatus,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
  }

  it.each(['pending', 'unverified_commits', 'pending_baseline'])(
    'rejects a stale approval range after delayed sync for %s',
    async (status) => {
      const appId = await linkedApp('source')
      const siblingApp = await linkedApp('sibling')
      await deployment(appId, 'base', 1)
      const target = await deployment(appId, 'head', 3, status)
      await expect(getEffectiveComparisonBaseSha(target, '9001', 'head')).resolves.toBe('base')
      await deployment(siblingApp, 'delayed-base', 2)
      await expect(getEffectiveComparisonBaseSha(target, '9001', 'head')).resolves.toBe('delayed-base')

      const form = new FormData()
      form.set('comparison_head_sha', 'head')
      form.set('comparison_base_sha', 'base')
      const result = await resolveReviewedComparisonRange(
        {
          id: target,
          monitored_app_id: appId,
          commit_sha: 'head',
          detected_github_owner: 'navikt',
          detected_github_repo_name: 'monorepo',
        },
        form,
      )
      expect(result.range).toBeNull()
      expect(result.error).toContain('endret')
      await expect(getLatestVerificationRun(target)).resolves.toMatchObject({
        status,
        result: { comparisonRange: { baseSha: 'base', headSha: 'head' } },
      })
    },
  )

  it.each(APPROVED_STATUSES)('preserves a documented approved range for %s', async (status) => {
    const appId = await linkedApp('source')
    const siblingApp = await linkedApp('sibling')
    await deployment(appId, 'base', 1)
    const target = await deployment(appId, 'head', 3, status)
    await deployment(siblingApp, 'delayed-base', 2)
    await expect(getEffectiveComparisonBaseSha(target, '9001', 'head')).resolves.toBe('base')
  })

  it('preserves an approved null base after delayed sync', async () => {
    const appId = await linkedApp('source')
    const siblingApp = await linkedApp('sibling')
    const target = await deployment(appId, 'head', 3, 'manually_approved')
    await deployment(siblingApp, 'delayed-base', 2)
    await expect(getEffectiveComparisonBaseSha(target, '9001', 'head')).resolves.toBeNull()
  })

  it.each([
    { deploymentStatus: 'approved', runStatus: 'pending', headSha: 'head' },
    { deploymentStatus: 'pending', runStatus: 'approved', headSha: 'head' },
    { deploymentStatus: 'approved', runStatus: 'approved', headSha: 'other-head' },
  ])('does not freeze a mismatched run: %j', async ({ deploymentStatus, runStatus, headSha }) => {
    const appId = await linkedApp('source')
    await deployment(appId, 'base', 1)
    const target = await deployment(appId, 'head', 3, deploymentStatus)
    await saveVerificationRun(
      target,
      { status: runStatus, result: { comparisonRange: { baseSha: 'stale-base', headSha } } },
      { prSnapshotIds: [], commitSnapshotIds: [] },
    )
    await expect(getEffectiveComparisonBaseSha(target, '9001', 'head')).resolves.toBe('base')
  })

  it.each([
    { label: 'missing', range: undefined, status: 'approved' },
    { label: 'wrong head', range: { baseSha: null, headSha: 'other-head' }, status: 'approved' },
    { label: 'missing base', range: { headSha: 'head' }, status: 'approved' },
    { label: 'wrong status', range: { baseSha: null, headSha: 'head' }, status: 'error' },
  ])('does not share a root with $label approval evidence', async ({ range, status }) => {
    const sourceApp = await linkedApp('source')
    const targetApp = await linkedApp('target')
    const source = await seedUnrecordedDeployment(pool, {
      monitoredAppId: sourceApp,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head',
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    if (range !== undefined) {
      await saveVerificationRun(
        source,
        { status, result: { comparisonRange: range } },
        { prSnapshotIds: [], commitSnapshotIds: [] },
      )
    }
    const target = await deployment(targetApp, 'head', 5)
    await expect(findRootApprovedSiblingForCommit('head', '9001', null, target, targetApp)).resolves.toBeNull()
    await expect(propagateVerificationToSiblings(source, 'approved', 'head', sourceApp)).resolves.toBe(0)
    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [source])
    expect(rows[0].four_eyes_status).toBe('approved')
  })

  it('does not extend a recorded approval to a divergent range introduced by delayed sync', async () => {
    const sourceApp = await linkedApp('source')
    const siblingApp = await linkedApp('sibling')
    const targetApp = await linkedApp('target')
    await deployment(sourceApp, 'base', 1)
    const source = await deployment(sourceApp, 'head', 3, 'manually_approved')
    await saveVerificationRun(
      source,
      {
        status: 'manually_approved',
        result: { comparisonRange: { baseSha: 'base', headSha: 'head' } },
      },
      { prSnapshotIds: [], commitSnapshotIds: [] },
    )
    await expect(getMonorepoComparisonBase(source, '9001', 'head')).resolves.toMatchObject({
      commit_sha: 'base',
    })

    await deployment(siblingApp, 'diverged', 2)
    const target = await deployment(targetApp, 'head', 4)
    await expect(getMonorepoComparisonBase(source, '9001', 'head')).resolves.toMatchObject({
      commit_sha: 'diverged',
    })
    await expect(getLatestVerificationRun(source)).resolves.toMatchObject({
      result: { comparisonRange: { baseSha: 'base', headSha: 'head' } },
    })

    const ancestry = vi.mocked(getCommitAncestryStatus)
    ancestry.mockClear()
    ancestry.mockResolvedValueOnce('diverged')
    const root = await findRootApprovedSiblingForCommit('head', '9001', 'diverged', target, targetApp)
    const propagated = await propagateVerificationToSiblings(source, 'manually_approved', 'head', sourceApp)
    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [target])

    expect.soft(root).toBeNull()
    expect.soft(propagated).toBe(0)
    expect.soft(rows[0].four_eyes_status).toBe('pending')
    expect(ancestry).not.toHaveBeenCalled()
    ancestry.mockReset().mockResolvedValue('identical')
  })

  it('does not share a redeploy approval for a new repository range through either resolution path', async () => {
    const sourceApp = await linkedApp('source')
    const siblingApp = await linkedApp('sibling')
    const targetApp = await linkedApp('target')
    await deployment(sourceApp, 'base', 1)
    await deployment(sourceApp, 'head', 2, 'approved')
    await deployment(siblingApp, 'diverged', 3)
    const redeploy = await deployment(sourceApp, 'head', 4, 'no_changes')
    const target = await deployment(targetApp, 'head', 5)

    await expect(findRootApprovedSiblingForCommit('head', '9001', 'diverged', target, targetApp)).resolves.toBeNull()
    await expect(getPreviousDeploymentForDiff(target, '9001')).resolves.toMatchObject({
      id: redeploy,
      comparison_base_sha: 'diverged',
      can_share_approval: false,
    })
    await expect(getPreviousDeployment(target, 'navikt', 'monorepo', '9001', null, 'head')).resolves.toMatchObject({
      id: redeploy,
      canShareApproval: false,
    })
    await expect(propagateVerificationToSiblings(redeploy, 'no_changes', 'head', sourceApp)).resolves.toBe(0)
    const { rows } = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [target])
    expect(rows[0].four_eyes_status).toBe('pending')
    const history = await pool.query(
      "SELECT id FROM deployment_status_history WHERE deployment_id = $1 AND change_source = 'sibling_propagation'",
      [target],
    )
    expect(history.rows).toHaveLength(0)

    const originalRangeTarget = await deployment(targetApp, 'head', 2)
    await expect(
      findRootApprovedSiblingForCommit('head', '9001', 'base', originalRangeTarget, targetApp),
    ).resolves.toMatchObject({ monitoredAppId: sourceApp, fourEyesStatus: 'approved' })
  })

  it('still shares no_changes when the same-app SHA changed and the repository range was verified', async () => {
    const sourceApp = await linkedApp('source')
    const targetApp = await linkedApp('target')
    await deployment(sourceApp, 'base', 1)
    const source = await deployment(sourceApp, 'head', 2, 'no_changes')
    const target = await deployment(targetApp, 'head', 3)

    await expect(findRootApprovedSiblingForCommit('head', '9001', 'base', target, targetApp)).resolves.toMatchObject({
      id: source,
    })
    await expect(propagateVerificationToSiblings(source, 'no_changes', 'head', sourceApp)).resolves.toBe(1)
  })

  it('keeps a recorded redeploy ineligible after delayed same-app history changes', async () => {
    const sourceApp = await linkedApp('source')
    const siblingApp = await linkedApp('sibling')
    const targetApp = await linkedApp('target')
    await deployment(sourceApp, 'head', 1)
    await deployment(siblingApp, 'diverged', 2)
    const redeploy = await deployment(sourceApp, 'head', 4, 'no_changes')
    await deployment(sourceApp, 'diverged', 3)
    const target = await deployment(targetApp, 'head', 5)

    await expect(getMonorepoComparisonBase(redeploy, '9001', 'head')).resolves.toMatchObject({
      is_same_app_redeploy: false,
    })
    await expect(findRootApprovedSiblingForCommit('head', '9001', 'diverged', target, targetApp)).resolves.toBeNull()
    await expect(propagateVerificationToSiblings(redeploy, 'no_changes', 'head', sourceApp)).resolves.toBe(0)
    await expect(getPreviousDeploymentForDiff(target, '9001')).resolves.toMatchObject({
      id: redeploy,
      can_share_approval: false,
    })
    await expect(getPreviousDeployment(target, 'navikt', 'monorepo', '9001', null, 'head')).resolves.toMatchObject({
      id: redeploy,
      canShareApproval: false,
    })

    await expect(getLatestVerificationRun(redeploy)).resolves.toMatchObject({
      result: {
        comparisonRange: { baseSha: 'diverged', headSha: 'head' },
        isSameAppRedeploy: true,
      },
    })
  })

  it.each([undefined, null, 'false', true])(
    'does not share no_changes without explicit non-redeploy evidence: %s',
    async (isSameAppRedeploy) => {
      const sourceApp = await linkedApp('source')
      const targetApp = await linkedApp('target')
      const source = await deployment(sourceApp, 'head', 1, 'no_changes')
      await saveVerificationRun(
        source,
        {
          status: 'no_changes',
          result: { comparisonRange: { baseSha: null, headSha: 'head' }, isSameAppRedeploy },
        },
        { prSnapshotIds: [], commitSnapshotIds: [] },
      )
      const target = await deployment(targetApp, 'head', 2)
      await expect(findRootApprovedSiblingForCommit('head', '9001', null, target, targetApp)).resolves.toBeNull()
      await expect(propagateVerificationToSiblings(source, 'no_changes', 'head', sourceApp)).resolves.toBe(0)
    },
  )

  it('excludes same-app roots while accepting sibling roots with identical timestamps', async () => {
    const appId = await linkedApp('source')
    const siblingApp = await linkedApp('sibling')
    const first = await deployment(appId, 'head', 1)
    await deployment(appId, 'head', 1, 'manually_approved')

    await expect(findRootApprovedSiblingForCommit('head', '9001', null, first, appId)).resolves.toBeNull()
    const siblingRoot = await deployment(siblingApp, 'head', 1, 'manually_approved')
    await expect(findRootApprovedSiblingForCommit('head', '9001', null, first, appId)).resolves.toMatchObject({
      id: siblingRoot,
      monitoredAppId: siblingApp,
    })
    const later = await deployment(appId, 'head', 2)
    await expect(findRootApprovedSiblingForCommit('head', '9001', null, later, appId)).resolves.toMatchObject({
      id: siblingRoot,
      monitoredAppId: siblingApp,
      fourEyesStatus: 'manually_approved',
    })
  })

  it('does not let an older same-app root mask a matching sibling root', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
    const currentId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-b', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: appId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9001',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: currentId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9001',
    })

    await seedDeployment(pool, {
      monitoredAppId: currentId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const siblingRootId = await seedDeployment(pool, {
      monitoredAppId: appId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      createdAt: new Date('2026-01-02T10:00:00Z'),
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    const redeployRoot = await findRootApprovedSiblingForCommit('head-sha', '9001', null, undefined, currentId)
    const differentRangeRoot = await findRootApprovedSiblingForCommit(
      'head-sha',
      '9001',
      'different-base-sha',
      undefined,
      currentId,
    )

    expect(redeployRoot?.id).toBe(siblingRootId)
    expect(redeployRoot?.monitoredAppId).toBe(appId)
    expect(differentRangeRoot).toBeNull()
  })

  it('does not chain a recorded sibling approval into another application', async () => {
    const rootApp = await linkedApp('root')
    const intermediateApp = await linkedApp('intermediate')
    const targetApp = await linkedApp('target')
    const root = await deployment(rootApp, 'head', 1, 'approved')
    const intermediate = await deployment(intermediateApp, 'head', 2, 'verified_via_sibling')
    const target = await deployment(targetApp, 'head', 3)

    await expect(
      propagateVerificationToSiblings(intermediate, 'verified_via_sibling', 'head', intermediateApp),
    ).resolves.toBe(0)
    const unchanged = await pool.query('SELECT four_eyes_status FROM deployments WHERE id = $1', [target])
    expect(unchanged.rows[0].four_eyes_status).toBe('pending')
    const history = await pool.query('SELECT id FROM deployment_status_history WHERE deployment_id = $1', [target])
    expect(history.rows).toHaveLength(0)

    await expect(findRootApprovedSiblingForCommit('head', '9001', null, target, targetApp)).resolves.toMatchObject({
      id: root,
      monitoredAppId: rootApp,
    })
    await expect(propagateVerificationToSiblings(root, 'approved', 'head', rootApp)).resolves.toBe(1)
    const propagated = await pool.query(
      "SELECT details->>'source_deployment_id' AS source FROM deployment_status_history WHERE deployment_id = $1",
      [target],
    )
    expect(propagated.rows).toEqual([{ source: String(root) }])
  })

  it.each(['base', null])('preserves the propagated interval with base %s after delayed sync', async (baseSha) => {
    const rootApp = await linkedApp('root')
    const targetApp = await linkedApp('target')
    if (baseSha) await deployment(rootApp, baseSha, 1)
    const root = await deployment(rootApp, 'head', 3, 'approved')
    const target = await deployment(targetApp, 'head', 4)

    await expect(propagateVerificationToSiblings(root, 'approved', 'head', rootApp)).resolves.toBe(1)
    await expect(getLatestVerificationRun(target)).resolves.toMatchObject({ status: 'pending' })
    await deployment(rootApp, 'delayed-base', 2)
    await expect(getEffectiveComparisonBaseSha(target, '9001', 'head')).resolves.toBe(baseSha)
    await expect(findRootApprovedSiblingForCommit('head', '9001', baseSha, root, rootApp)).resolves.toBeNull()
    await expect(propagateVerificationToSiblings(target, 'verified_via_sibling', 'head', targetApp)).resolves.toBe(0)
  })

  it.each([
    {
      toStatus: 'pending',
      changeSource: 'sibling_propagation',
      details: { commit_sha: 'head', comparison_base_sha: 'base' },
    },
    {
      toStatus: 'verified_via_sibling',
      changeSource: 'verification',
      details: { commit_sha: 'head', comparison_base_sha: 'base' },
    },
    {
      toStatus: 'verified_via_sibling',
      changeSource: 'sibling_propagation',
      details: { commit_sha: 'other-head', comparison_base_sha: 'base' },
    },
    { toStatus: 'verified_via_sibling', changeSource: 'sibling_propagation', details: { commit_sha: 'head' } },
    {
      toStatus: 'verified_via_sibling',
      changeSource: 'sibling_propagation',
      details: { commit_sha: 'head', comparison_base_sha: '' },
    },
    {
      toStatus: 'verified_via_sibling',
      changeSource: 'sibling_propagation',
      details: { commit_sha: 'head', comparison_base_sha: 42 },
    },
  ])('does not reuse propagation evidence after a mismatched latest transition: %j', async (transition) => {
    const rootApp = await linkedApp('root')
    const targetApp = await linkedApp('target')
    await deployment(rootApp, 'base', 1)
    const root = await deployment(rootApp, 'head', 3, 'approved')
    const target = await deployment(targetApp, 'head', 4)
    await propagateVerificationToSiblings(root, 'approved', 'head', rootApp)
    await deployment(rootApp, 'delayed-base', 2)
    await pool.query(
      `INSERT INTO deployment_status_history (deployment_id, to_status, change_source, details)
       VALUES ($1, $2, $3, $4)`,
      [target, transition.toStatus, transition.changeSource, JSON.stringify(transition.details)],
    )

    await expect(getEffectiveComparisonBaseSha(target, '9001', 'head')).resolves.toBe('delayed-base')
  })

  it('excludes the deployment being reverified from its root lookup', async () => {
    const siblingAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-a', environment: 'prod' })
    const currentAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'app-b', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: siblingAppId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9002',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: currentAppId,
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
      githubRepoId: '9002',
    })
    await seedDeployment(pool, {
      monitoredAppId: siblingAppId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      fourEyesStatus: 'pending',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })
    const currentDeploymentId = await seedDeployment(pool, {
      monitoredAppId: currentAppId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'head-sha',
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'monorepo',
    })

    const root = await findRootApprovedSiblingForCommit(
      'head-sha',
      '9002',
      'base-sha',
      currentDeploymentId,
      currentAppId,
    )

    expect(root).toBeNull()
  })

  it('does not accept a root through a historical repo link after the app moved to another repository', async () => {
    const rootAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'old-app', environment: 'prod' })
    const currentAppId = await seedApp(pool, { teamSlug: 'team-a', appName: 'current-app', environment: 'prod' })
    await seedApplicationRepository(pool, {
      monitoredAppId: rootAppId,
      githubOwner: 'navikt',
      githubRepo: 'old-monorepo',
      githubRepoId: '9003',
      status: 'historical',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: rootAppId,
      githubOwner: 'navikt',
      githubRepo: 'new-repository',
      githubRepoId: '9004',
    })
    await seedApplicationRepository(pool, {
      monitoredAppId: currentAppId,
      githubOwner: 'navikt',
      githubRepo: 'old-monorepo',
      githubRepoId: '9003',
    })
    await seedDeployment(pool, {
      monitoredAppId: rootAppId,
      teamSlug: 'team-a',
      environment: 'prod',
      commitSha: 'shared-head',
      fourEyesStatus: 'approved',
      githubOwner: 'navikt',
      githubRepo: 'old-monorepo',
    })

    const root = await findRootApprovedSiblingForCommit('shared-head', '9003', 'shared-base', undefined, currentAppId)

    expect(root).toBeNull()
  })
})
