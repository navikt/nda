import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitoredApplication } from '~/db/monitored-applications.server'
import type { NaisApplicationUpdatedActivity } from '~/lib/nais.server'

const {
  getNaisApplyActivityEvents,
  markNaisApplyActivitiesMaterialized,
  getMonitoredApplicationById,
  upsertNaisApplyDeployment,
  fetchWorkflowRunHeadSha,
  getRepositoryIdentityById,
  upsertNaisApplyRepository,
  getRepositoriesByAppId,
  createRepositoryAlertForDeployment,
  ensureRepositoryRowForGithubRepo,
  syncRepositoryDefaultBranch,
  syncDefaultBranchForApp,
} = vi.hoisted(() => ({
  getNaisApplyActivityEvents: vi.fn(),
  markNaisApplyActivitiesMaterialized: vi.fn(),
  getMonitoredApplicationById: vi.fn(),
  upsertNaisApplyDeployment: vi.fn(),
  fetchWorkflowRunHeadSha: vi.fn(),
  getRepositoryIdentityById: vi.fn(),
  upsertNaisApplyRepository: vi.fn(),
  getRepositoriesByAppId: vi.fn(),
  createRepositoryAlertForDeployment: vi.fn(),
  ensureRepositoryRowForGithubRepo: vi.fn(),
  syncRepositoryDefaultBranch: vi.fn(),
  syncDefaultBranchForApp: vi.fn(),
}))

vi.mock('~/db/nais-apply-activity.server', () => ({
  getNaisApplyActivityEvents,
  markNaisApplyActivitiesMaterialized,
}))
vi.mock('~/db/deployments.server', () => ({ upsertNaisApplyDeployment }))
vi.mock('~/db/monitored-applications.server', () => ({ getMonitoredApplicationById }))
vi.mock('~/db/application-repositories.server', () => ({
  getRepositoriesByAppId,
  upsertNaisApplyRepository,
}))
vi.mock('~/db/alerts.server', () => ({ createRepositoryAlertForDeployment }))
vi.mock('~/db/repositories.server', () => ({ ensureRepositoryRowForGithubRepo, syncRepositoryDefaultBranch }))
vi.mock('~/lib/github/git.server', () => ({ fetchWorkflowRunHeadSha, getRepositoryIdentityById }))
vi.mock('../default-branch-sync.server', () => ({ syncDefaultBranchForApp }))
vi.mock('~/lib/logger.server', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { materializeNaisApplyDeployments } from '../nais-apply-materialize.server'

const monitoredApp: MonitoredApplication = {
  id: 7,
  team_slug: 'team-a',
  environment_name: 'prod-gcp',
  app_name: 'app-a',
  is_active: true,
  default_branch: null,
  default_branch_synced_at: null,
  test_requirement: 'none',
  slack_channel_id: null,
  slack_notifications_enabled: false,
  reminder_enabled: false,
  reminder_time: null,
  reminder_days: null,
  reminder_last_sent_at: null,
  reminder_channel_id: null,
  slack_notifications_enabled_at: null,
  slack_deploy_channel_id: null,
  slack_deploy_notify_enabled: false,
  slack_deploy_notify_enabled_at: null,
  not_found_in_nais_at: null,
  initial_nais_history_synced_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
}

function makeActivity(
  id: string,
  newImage: string,
  overrides: Partial<NaisApplicationUpdatedActivity> = {},
): NaisApplicationUpdatedActivity {
  return {
    id,
    createdAt: '2026-10-15T10:00:00.000Z',
    actor: 'Rask Elv',
    message: 'Updated application',
    resourceName: 'app-a',
    teamSlug: 'team-a',
    environmentName: 'prod-gcp',
    gitHubActorClaims: {
      actor: 'rask-elv',
      repository: 'navikt/app-a',
      repositoryID: '12345',
      workflow: '.github/workflows/deploy.yml',
      runID: '98765',
      runAttempt: '1',
      checkRunID: '554433',
      workflowSha: 'workflow-sha',
      workflowRef: 'refs/heads/main',
      ref: 'refs/heads/main',
      eventName: 'push',
    },
    changedFields: [{ field: 'spec.image', oldValue: 'old-image', newValue: newImage }],
    ...overrides,
  }
}

describe('materializeNaisApplyDeployments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMonitoredApplicationById).mockResolvedValue(monitoredApp)
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([])
    vi.mocked(markNaisApplyActivitiesMaterialized).mockResolvedValue(undefined)
    vi.mocked(upsertNaisApplyDeployment).mockResolvedValue({ id: 100 } as never)
    vi.mocked(fetchWorkflowRunHeadSha).mockResolvedValue('a'.repeat(40))
    vi.mocked(getRepositoryIdentityById).mockResolvedValue({ id: 12345, owner: 'navikt', name: 'app-a' })
    vi.mocked(getRepositoriesByAppId).mockResolvedValue([])
    vi.mocked(upsertNaisApplyRepository).mockResolvedValue({
      github_owner: 'navikt',
      github_repo_name: 'app-a',
      github_repo_id: '12345',
      status: 'active',
      canonicalGithubOwner: 'navikt',
      canonicalGithubRepoName: 'app-a',
    } as never)
    vi.mocked(syncRepositoryDefaultBranch).mockResolvedValue(true)
    vi.mocked(ensureRepositoryRowForGithubRepo).mockResolvedValue({} as never)
    vi.mocked(syncDefaultBranchForApp).mockResolvedValue(undefined)
  })

  it('does not rediscover a repository rejected by an administrator', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('activity-1', 'registry/image:sha1')])
    vi.mocked(upsertNaisApplyRepository).mockResolvedValue(null)

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(upsertNaisApplyRepository).toHaveBeenCalledWith({
      monitoredAppId: monitoredApp.id,
      githubOwner: 'navikt',
      githubRepoName: 'app-a',
      githubRepoId: '12345',
    })
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ detectedGithubRepositoryId: null }),
    )
  })

  it('ensures canonical repository metadata for approved historical links without syncing their branch', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('activity-1', 'registry/image:sha1')])
    vi.mocked(upsertNaisApplyRepository).mockResolvedValue({
      github_owner: 'navikt',
      github_repo_name: 'app-a',
      github_repo_id: '12345',
      status: 'historical',
      canonicalGithubOwner: 'navikt',
      canonicalGithubRepoName: 'app-a',
    } as never)

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(ensureRepositoryRowForGithubRepo).toHaveBeenCalledWith({
      githubRepoId: '12345',
      githubOwner: 'navikt',
      githubRepoName: 'app-a',
    })
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ detectedGithubRepositoryId: '12345' }),
    )
    expect(syncRepositoryDefaultBranch).not.toHaveBeenCalled()
  })

  it('uses GitHub current names when historical claims refer to a renamed repository', async () => {
    const activity = makeActivity('activity-1', 'registry/image:sha1')
    const claims = activity.gitHubActorClaims
    if (!claims) throw new Error('Expected GitHub claims')
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      { ...activity, gitHubActorClaims: { ...claims, repository: 'navikt/old-app-a' } },
    ])
    vi.mocked(getRepositoryIdentityById).mockResolvedValue({ id: 12345, owner: 'navikt', name: 'app-a' })

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(getRepositoryIdentityById).toHaveBeenCalledWith(12345)
    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledWith('navikt', 'app-a', 98765, 1, '12345')
    expect(ensureRepositoryRowForGithubRepo).toHaveBeenCalledWith({
      githubRepoId: '12345',
      githubOwner: 'navikt',
      githubRepoName: 'app-a',
    })
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedGithubOwner: 'navikt',
        detectedGithubRepoName: 'old-app-a',
        detectedGithubRepositoryId: '12345',
        triggerUrl: 'https://github.com/navikt/app-a/actions/runs/98765',
      }),
    )
  })

  it('resolves historical Apply claims by immutable ID when their old name has been reused', async () => {
    const activity = makeActivity('activity-1', 'registry/image:sha1')
    const claims = activity.gitHubActorClaims
    if (!claims) throw new Error('Expected GitHub claims')
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      { ...activity, gitHubActorClaims: { ...claims, repository: 'navikt/old-app-a' } },
    ])
    vi.mocked(getRepositoryIdentityById).mockResolvedValue({ id: 12345, owner: 'navikt', name: 'current-app-a' })

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(getRepositoryIdentityById).toHaveBeenCalledWith(12345)
    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledWith('navikt', 'current-app-a', 98765, 1, '12345')
    expect(upsertNaisApplyRepository).toHaveBeenCalledWith({
      monitoredAppId: monitoredApp.id,
      githubOwner: 'navikt',
      githubRepoName: 'current-app-a',
      githubRepoId: '12345',
    })
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedGithubOwner: 'navikt',
        detectedGithubRepoName: 'old-app-a',
        detectedGithubRepositoryId: '12345',
        triggerUrl: 'https://github.com/navikt/current-app-a/actions/runs/98765',
      }),
    )
  })

  it('re-canonicalizes each claimed alias of the same repository ID', async () => {
    const firstActivity = makeActivity('activity-1', 'registry/image:sha1')
    const firstClaims = firstActivity.gitHubActorClaims
    if (!firstClaims) throw new Error('Expected GitHub claims')
    const secondActivity = makeActivity('activity-2', 'registry/image:sha2', {
      gitHubActorClaims: {
        ...firstClaims,
        repository: 'navikt/current-app-a',
        checkRunID: '554434',
      },
    })
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      {
        ...firstActivity,
        gitHubActorClaims: { ...firstClaims, repository: 'navikt/old-app-a' },
      },
      secondActivity,
    ])
    vi.mocked(getRepositoriesByAppId).mockResolvedValue([
      {
        github_owner: 'navikt',
        github_repo_name: 'old-app-a',
        github_repo_id: '12345',
        status: 'active',
      } as never,
    ])

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(ensureRepositoryRowForGithubRepo).toHaveBeenCalledTimes(2)
    expect(ensureRepositoryRowForGithubRepo).toHaveBeenNthCalledWith(1, {
      githubRepoId: '12345',
      githubOwner: 'navikt',
      githubRepoName: 'app-a',
    })
    expect(ensureRepositoryRowForGithubRepo).toHaveBeenNthCalledWith(2, {
      githubRepoId: '12345',
      githubOwner: 'navikt',
      githubRepoName: 'app-a',
    })
  })

  it('does not sync default branch for an older active repository link', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('activity-1', 'registry/image:sha1')])
    vi.mocked(upsertNaisApplyRepository).mockResolvedValue({
      github_owner: 'navikt',
      github_repo_name: 'app-a',
      github_repo_id: '12345',
      status: 'active',
      canonicalGithubOwner: 'navikt',
      canonicalGithubRepoName: 'app-a',
    } as never)
    vi.mocked(getRepositoriesByAppId).mockResolvedValue([
      { github_owner: 'navikt', github_repo_name: 'new-app', github_repo_id: '99999', status: 'active' } as never,
      { github_owner: 'navikt', github_repo_name: 'app-a', github_repo_id: '12345', status: 'active' } as never,
    ])

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ detectedGithubRepositoryId: '12345' }),
    )
    expect(syncRepositoryDefaultBranch).not.toHaveBeenCalled()
    expect(syncDefaultBranchForApp).not.toHaveBeenCalled()
  })

  it('groups image updates by GitHub check run and uses its verified run head SHA', async () => {
    vi.mocked(getRepositoriesByAppId).mockResolvedValueOnce([{ github_repo_id: '12345', status: 'active' } as never])
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('activity-1', 'registry/image:sha1', { createdAt: '2026-10-15T10:01:00.000Z' }),
      makeActivity('activity-2', 'registry/image:sha1', { createdAt: '2026-10-15T10:02:00.000Z' }),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(1)

    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledOnce()
    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledWith('navikt', 'app-a', 98765, 1, '12345')
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        commitSha: 'a'.repeat(40),
        createdAt: new Date('2026-10-15T10:01:00.000Z'),
        detectedGithubOwner: 'navikt',
        detectedGithubRepoName: 'app-a',
        triggerUrl: 'https://github.com/navikt/app-a/actions/runs/98765',
        detectedGithubRepositoryId: '12345',
        resources: [{ id: expect.any(String), kind: 'Image', name: 'registry/image:sha1' }],
      }),
    )
    expect(upsertNaisApplyRepository).toHaveBeenCalledWith({
      monitoredAppId: monitoredApp.id,
      githubOwner: 'navikt',
      githubRepoName: 'app-a',
      githubRepoId: '12345',
    })
    expect(syncRepositoryDefaultBranch).toHaveBeenCalledWith(
      expect.objectContaining({
        monitoredAppId: monitoredApp.id,
        onlyIfMissing: true,
        expectedGithubRepoId: '12345',
      }),
    )
    expect(ensureRepositoryRowForGithubRepo).toHaveBeenCalledWith({
      githubRepoId: '12345',
      githubOwner: 'navikt',
      githubRepoName: 'app-a',
    })
  })

  it('creates a pending repository link and alert for an unrecognized claimed repository', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('activity-1', 'registry/image:sha1')])
    vi.mocked(getRepositoriesByAppId).mockResolvedValue([
      { github_owner: 'navikt', github_repo_name: 'old-app', github_repo_id: '54321' } as never,
    ])
    vi.mocked(upsertNaisApplyRepository).mockResolvedValue({
      github_owner: 'navikt',
      github_repo_name: 'app-a',
      github_repo_id: '12345',
      status: 'pending_approval',
      canonicalGithubOwner: 'navikt',
      canonicalGithubRepoName: 'app-a',
    } as never)

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(upsertNaisApplyRepository).toHaveBeenCalled()
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ detectedGithubRepositoryId: null }),
    )
    expect(createRepositoryAlertForDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: 100,
        alertType: 'pending_approval',
        detectedGithubOwner: 'navikt',
        detectedGithubRepoName: 'app-a',
      }),
    )
  })

  it('does not associate a deployment with a linked repository whose immutable ID differs from the claim', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('activity-1', 'registry/image:sha1')])
    vi.mocked(upsertNaisApplyRepository).mockResolvedValue({
      github_owner: 'navikt',
      github_repo_name: 'app-a',
      github_repo_id: '54321',
      status: 'active',
      canonicalGithubOwner: 'navikt',
      canonicalGithubRepoName: 'app-a',
    } as never)

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedGithubRepositoryId: null,
        commitSha: 'a'.repeat(40),
      }),
    )
  })

  it('keeps image changes without claims as separate unverifiable source records', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('laptop-1', 'registry/image:one', { gitHubActorClaims: null }),
      makeActivity('laptop-2', 'registry/image:two', { gitHubActorClaims: null }),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(2)

    expect(fetchWorkflowRunHeadSha).not.toHaveBeenCalled()
    expect(upsertNaisApplyDeployment).toHaveBeenCalledTimes(2)
    expect(upsertNaisApplyDeployment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ commitSha: null, detectedGithubOwner: null, detectedGithubRepoName: null }),
    )
    expect(upsertNaisApplyDeployment.mock.calls[0][0].sourceId).not.toBe(
      upsertNaisApplyDeployment.mock.calls[1][0].sourceId,
    )
  })

  it('does not normalize events without an exact environment match', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('other-env', 'registry/image:one', { environmentName: null }),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(0)

    expect(upsertNaisApplyDeployment).not.toHaveBeenCalled()
  })

  it('materializes activities without an opt-in setting', async () => {
    vi.mocked(getMonitoredApplicationById).mockResolvedValueOnce(monitoredApp).mockResolvedValueOnce(monitoredApp)
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('activity-1', 'registry/image:sha1')])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(1)
    expect(upsertNaisApplyRepository).toHaveBeenCalled()
    expect(upsertNaisApplyDeployment).toHaveBeenCalled()
  })

  it('does not group different images from the same check run', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('activity-1', 'registry/image:one'),
      makeActivity('activity-2', 'registry/image:two'),
    ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(2)

    expect(fetchWorkflowRunHeadSha).toHaveBeenCalledOnce()
    expect(upsertNaisApplyDeployment).toHaveBeenCalledTimes(2)
  })

  it('does not resolve runs or update deployments when no activities need processing', async () => {
    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(0)

    expect(getNaisApplyActivityEvents).toHaveBeenCalledExactlyOnceWith(monitoredApp.id, { fullHistory: false })
    expect(getRepositoryIdentityById).not.toHaveBeenCalled()
    expect(fetchWorkflowRunHeadSha).not.toHaveBeenCalled()
    expect(upsertNaisApplyDeployment).not.toHaveBeenCalled()
  })

  it('loads all retained activities only for the initial history pass', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('activity-1', 'registry/image:one')])

    await materializeNaisApplyDeployments(monitoredApp.id, { fullHistory: true, suppressNotifications: true })

    expect(getNaisApplyActivityEvents).toHaveBeenCalledExactlyOnceWith(monitoredApp.id, { fullHistory: true })
    expect(upsertNaisApplyDeployment).toHaveBeenCalledWith(expect.objectContaining({ suppressNotifications: true }))
    expect(markNaisApplyActivitiesMaterialized).toHaveBeenCalledWith(monitoredApp.id, [
      { activityLogId: 'activity-1', sourceIds: [expect.any(String)], retry: false },
    ])
  })

  it('merges a delayed activity with older group members without processing unrelated history', async () => {
    const historical = makeActivity('historical', 'registry/image:one', { createdAt: '2026-10-15T10:01:00Z' })
    const delayed = makeActivity('delayed', 'registry/image:one', { createdAt: '2026-10-15T10:00:00Z' })
    vi.mocked(getNaisApplyActivityEvents)
      .mockResolvedValueOnce([delayed])
      .mockResolvedValueOnce([
        historical,
        makeActivity('unrelated', 'registry/image:two'),
        makeActivity('wrong-env', 'registry/image:one', {
          environmentName: 'dev-gcp',
          createdAt: '2026-10-14T10:00:00Z',
        }),
      ])

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).resolves.toBe(1)

    const { sourceId } = upsertNaisApplyDeployment.mock.calls[0][0]
    expect(getNaisApplyActivityEvents).toHaveBeenNthCalledWith(2, monitoredApp.id, { sourceIds: [sourceId] })
    expect(upsertNaisApplyDeployment).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sourceId, createdAt: new Date(delayed.createdAt) }),
    )
    expect(markNaisApplyActivitiesMaterialized).toHaveBeenCalledWith(monitoredApp.id, [
      { activityLogId: 'delayed', sourceIds: [sourceId], retry: false },
    ])
  })

  it('keeps the earliest historical timestamp when a later group member arrives', async () => {
    vi.mocked(getNaisApplyActivityEvents)
      .mockResolvedValueOnce([makeActivity('later', 'registry/image:one', { createdAt: '2026-10-16T10:00:00Z' })])
      .mockResolvedValueOnce([makeActivity('historical', 'registry/image:one')])

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(upsertNaisApplyDeployment).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ createdAt: new Date('2026-10-15T10:00:00Z') }),
    )
  })

  it.each(['sha', 'identity', 'approval'] as const)('schedules unresolved %s groups for retry', async (missing) => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('unresolved', 'registry/image:one')])
    if (missing === 'sha') vi.mocked(fetchWorkflowRunHeadSha).mockResolvedValue(null)
    if (missing === 'identity') vi.mocked(getRepositoryIdentityById).mockResolvedValue(null)
    if (missing === 'approval') {
      vi.mocked(upsertNaisApplyRepository).mockResolvedValue({
        github_repo_id: '12345',
        status: 'pending_approval',
      })
    }

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(markNaisApplyActivitiesMaterialized).toHaveBeenCalledWith(monitoredApp.id, [
      { activityLogId: 'unresolved', sourceIds: [expect.any(String)], retry: true },
    ])
  })

  it('completes an unresolved group when a subsequent attempt resolves its SHA', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('retry', 'registry/image:one')])
    vi.mocked(fetchWorkflowRunHeadSha).mockResolvedValueOnce(null).mockResolvedValueOnce('a'.repeat(40))

    await materializeNaisApplyDeployments(monitoredApp.id)
    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(markNaisApplyActivitiesMaterialized).toHaveBeenNthCalledWith(1, monitoredApp.id, [
      { activityLogId: 'retry', sourceIds: [expect.any(String)], retry: true },
    ])
    expect(markNaisApplyActivitiesMaterialized).toHaveBeenNthCalledWith(2, monitoredApp.id, [
      { activityLogId: 'retry', sourceIds: [expect.any(String)], retry: false },
    ])
  })

  it('does not repeatedly retry immutable events without usable claims or image changes', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([
      makeActivity('manual', 'registry/image:one', { gitHubActorClaims: null }),
      makeActivity('no-image', 'registry/image:two', { changedFields: [] }),
    ])

    await materializeNaisApplyDeployments(monitoredApp.id)

    expect(markNaisApplyActivitiesMaterialized).toHaveBeenCalledWith(monitoredApp.id, [
      { activityLogId: 'manual', sourceIds: [expect.any(String)], retry: false },
      { activityLogId: 'no-image', sourceIds: [], retry: false },
    ])
  })

  it('leaves activities pending if an upsert or alert fails', async () => {
    vi.mocked(getNaisApplyActivityEvents).mockResolvedValue([makeActivity('pending', 'registry/image:one')])
    vi.mocked(upsertNaisApplyDeployment).mockRejectedValueOnce(new Error('Database unavailable'))

    await expect(materializeNaisApplyDeployments(monitoredApp.id)).rejects.toThrow('Database unavailable')

    expect(markNaisApplyActivitiesMaterialized).not.toHaveBeenCalled()
  })
})
