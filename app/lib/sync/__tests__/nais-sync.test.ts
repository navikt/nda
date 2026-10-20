import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitoredApplication } from '~/db/monitored-applications.server'

const {
  createRepositoryAlert,
  createDeployment,
  fetchApplicationDeployments,
  fetchApplicationUpdatedActivityPage,
  fetchNewDeployments,
  findRepositoryForApp,
  getCurrentJobId,
  getDeploymentByNaisId,
  getLatestDeploymentForApp,
  getMonitoredApplicationById,
  getMonitoredApplicationByIdentity,
  getNaisApplyActivitySyncState,
  getRepositoriesByAppId,
  logger,
  markInitialNaisHistorySynced,
  markNaisApplyActivitySyncFailure,
  markNaisApplyActivitySyncComplete,
  materializeNaisApplyDeployments,
  saveNaisApplyActivityEvents,
  syncDefaultBranchForApp,
  updateMonitoredApplication,
  upsertApplicationRepository,
} = vi.hoisted(() => ({
  createRepositoryAlert: vi.fn(),
  createDeployment: vi.fn(),
  fetchApplicationDeployments: vi.fn(),
  fetchApplicationUpdatedActivityPage: vi.fn(),
  fetchNewDeployments: vi.fn(),
  findRepositoryForApp: vi.fn(),
  getCurrentJobId: vi.fn(),
  getDeploymentByNaisId: vi.fn(),
  getLatestDeploymentForApp: vi.fn(),
  getMonitoredApplicationById: vi.fn(),
  getMonitoredApplicationByIdentity: vi.fn(),
  getNaisApplyActivitySyncState: vi.fn(),
  getRepositoriesByAppId: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  markInitialNaisHistorySynced: vi.fn(),
  markNaisApplyActivitySyncFailure: vi.fn(),
  markNaisApplyActivitySyncComplete: vi.fn(),
  materializeNaisApplyDeployments: vi.fn(),
  saveNaisApplyActivityEvents: vi.fn(),
  syncDefaultBranchForApp: vi.fn(),
  updateMonitoredApplication: vi.fn(),
  upsertApplicationRepository: vi.fn(),
}))

vi.mock('~/db/alerts.server', () => ({ createRepositoryAlert }))
vi.mock('~/db/application-repositories.server', () => ({
  findRepositoryForApp,
  getRepositoriesByAppId,
  upsertApplicationRepository,
}))
vi.mock('~/db/deployments.server', () => ({
  createDeployment,
  getDeploymentByNaisId,
  getLatestDeploymentForApp,
}))
vi.mock('~/db/nais-apply-activity.server', () => ({
  getNaisApplyActivitySyncState,
  markNaisApplyActivitySyncFailure,
  markNaisApplyActivitySyncComplete,
  saveNaisApplyActivityEvents,
}))
vi.mock('../nais-apply-materialize.server', () => ({ materializeNaisApplyDeployments }))
vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationById,
  getMonitoredApplicationByIdentity,
  markInitialNaisHistorySynced,
  updateMonitoredApplication,
}))
vi.mock('~/lib/logger.server', () => ({ getCurrentJobId, logger }))
vi.mock('~/lib/nais.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/nais.server')>()
  return { ...actual, fetchApplicationDeployments, fetchApplicationUpdatedActivityPage, fetchNewDeployments }
})
vi.mock('../default-branch-sync.server', () => ({ syncDefaultBranchForApp }))

import { NaisDeploymentEnumerationError } from '~/lib/nais.server'
import { syncNaisApplyActivityFromNais, syncNewDeploymentsFromNais } from '../nais-sync.server'

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
  nais_apply_enabled: false,
  not_found_in_nais_at: null,
  initial_nais_history_synced_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
}

describe('syncNewDeploymentsFromNais initial full sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLatestDeploymentForApp).mockResolvedValue(null)
    vi.mocked(getMonitoredApplicationById).mockResolvedValue(monitoredApp)
    vi.mocked(getMonitoredApplicationByIdentity).mockResolvedValue(monitoredApp)
    vi.mocked(getNaisApplyActivitySyncState).mockResolvedValue(null)
    vi.mocked(fetchApplicationUpdatedActivityPage).mockResolvedValue({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    })
    vi.mocked(saveNaisApplyActivityEvents).mockResolvedValue(0)
    vi.mocked(markNaisApplyActivitySyncComplete).mockResolvedValue(undefined)
    vi.mocked(markNaisApplyActivitySyncFailure).mockResolvedValue(undefined)
    vi.mocked(materializeNaisApplyDeployments).mockResolvedValue(0)
    vi.mocked(createDeployment).mockResolvedValue(undefined as never)
    vi.mocked(getRepositoriesByAppId).mockResolvedValue([])
    vi.mocked(getCurrentJobId).mockReturnValue(42)
    vi.mocked(markInitialNaisHistorySynced).mockResolvedValue(true)
  })

  it.each([
    { description: 'unstable deployment ID sets', reason: 'deployment_id_set_changed' },
    { description: 'incomplete enumeration', reason: 'id_count_mismatch' },
  ] as const)('does not write deployments when Nais reports $description', async ({ reason }) => {
    const error = new NaisDeploymentEnumerationError({
      status: 'incomplete',
      reason,
    })
    vi.mocked(fetchApplicationDeployments).mockRejectedValue(error)

    await expect(syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)).rejects.toBe(error)

    expect(fetchApplicationDeployments).toHaveBeenCalledWith('team-a', 'prod-gcp', 'app-a')
    expect(createDeployment).not.toHaveBeenCalled()
    expect(upsertApplicationRepository).not.toHaveBeenCalled()
    expect(createRepositoryAlert).not.toHaveBeenCalled()
    expect(updateMonitoredApplication).not.toHaveBeenCalled()
    expect(syncDefaultBranchForApp).not.toHaveBeenCalled()
    expect(markInitialNaisHistorySynced).not.toHaveBeenCalled()
  })

  it('records initial history completion after processing a complete full enumeration', async () => {
    vi.mocked(fetchApplicationDeployments).mockResolvedValue([
      {
        id: 'deployment-1',
        createdAt: '2026-10-10T00:00:00Z',
        environmentName: 'prod-gcp',
        teamSlug: 'team-a',
        triggerUrl: '',
        repository: null,
        commitSha: null,
        deployerUsername: null,
        resources: { nodes: [] },
      },
    ])

    const result = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)

    expect(result).toEqual({
      newCount: 1,
      alertsCreated: 0,
      stoppedEarly: false,
      initialHistorySyncStatus: 'completed',
    })
    expect(createDeployment).toHaveBeenCalledOnce()
    expect(markInitialNaisHistorySynced).toHaveBeenCalledOnce()
    expect(markInitialNaisHistorySynced).toHaveBeenCalledWith(monitoredApp.id, 42)
    expect(createDeployment.mock.invocationCallOrder[0]).toBeLessThan(
      markInitialNaisHistorySynced.mock.invocationCallOrder[0],
    )
  })

  it('fails when the sync lease is no longer current at history completion', async () => {
    vi.mocked(fetchApplicationDeployments).mockResolvedValue([])
    vi.mocked(markInitialNaisHistorySynced).mockResolvedValue(false)

    await expect(syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)).rejects.toThrow(
      'Cannot mark initial Nais history sync complete: sync job lease is no longer current',
    )

    expect(markInitialNaisHistorySynced).toHaveBeenCalledWith(monitoredApp.id, 42)
  })

  it('does not record initial history completion when deployment processing fails', async () => {
    const error = new Error('deployment persistence failed')
    vi.mocked(fetchApplicationDeployments).mockResolvedValue([
      {
        id: 'deployment-1',
        createdAt: '2026-10-10T00:00:00Z',
        environmentName: 'prod-gcp',
        teamSlug: 'team-a',
        triggerUrl: '',
        repository: null,
        commitSha: null,
        deployerUsername: null,
        resources: { nodes: [] },
      },
    ])
    vi.mocked(createDeployment).mockRejectedValue(error)

    await expect(syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)).rejects.toBe(error)

    expect(createDeployment).toHaveBeenCalledOnce()
    expect(markInitialNaisHistorySynced).not.toHaveBeenCalled()
    expect(syncDefaultBranchForApp).not.toHaveBeenCalled()
  })

  it('uses incremental sync after initial history is complete', async () => {
    vi.mocked(getLatestDeploymentForApp).mockResolvedValue({ nais_deployment_id: 'deployment-1' } as never)
    vi.mocked(getMonitoredApplicationById).mockResolvedValue({
      ...monitoredApp,
      initial_nais_history_synced_at: new Date('2026-10-10T00:00:00Z'),
    })
    vi.mocked(fetchNewDeployments).mockResolvedValue({ deployments: [], stoppedEarly: false })

    const result = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)

    expect(result).toEqual({ newCount: 0, alertsCreated: 0, stoppedEarly: false })
    expect(fetchApplicationDeployments).not.toHaveBeenCalled()
    expect(fetchNewDeployments).toHaveBeenCalledOnce()
  })

  it('reprocesses existing deployments when resuming an incomplete initial history sync', async () => {
    vi.mocked(getLatestDeploymentForApp).mockResolvedValue({ nais_deployment_id: 'deployment-0' } as never)
    vi.mocked(getDeploymentByNaisId).mockResolvedValue({ monitored_app_id: monitoredApp.id } as never)
    vi.mocked(fetchApplicationDeployments).mockResolvedValue([
      {
        id: 'deployment-1',
        createdAt: '2026-10-10T00:00:00Z',
        environmentName: 'prod-gcp',
        teamSlug: 'team-a',
        triggerUrl: '',
        repository: 'navikt/new-repo',
        commitSha: 'abc123',
        deployerUsername: null,
        resources: { nodes: [] },
      },
    ])
    vi.mocked(getRepositoriesByAppId).mockResolvedValue([
      {
        id: 2,
        monitored_app_id: monitoredApp.id,
        github_owner: 'navikt',
        github_repo_name: 'old-repo',
        github_repo_id: null,
        status: 'active',
        redirects_to_owner: null,
        redirects_to_repo: null,
        notes: null,
        approved_at: null,
        approved_by: 'system',
        created_at: new Date('2026-10-09T00:00:00Z'),
      },
    ])
    vi.mocked(findRepositoryForApp).mockResolvedValue({
      repository: null,
      effectiveOwner: 'navikt',
      effectiveRepo: 'new-repo',
      isRedirected: false,
    })
    vi.mocked(createRepositoryAlert).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const firstResult = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)
    const secondResult = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)

    expect(getDeploymentByNaisId).toHaveBeenCalledWith('deployment-1', monitoredApp.id)
    expect(firstResult.initialHistorySyncStatus).toBe('completed')
    expect(secondResult.initialHistorySyncStatus).toBe('completed')
    expect(createDeployment).not.toHaveBeenCalled()
    expect(upsertApplicationRepository).toHaveBeenCalledTimes(2)
    expect(createRepositoryAlert).toHaveBeenCalledTimes(2)
    expect(markInitialNaisHistorySynced).toHaveBeenCalledTimes(2)
  })

  it('does not complete initial history when replay processing an existing deployment fails', async () => {
    const error = new Error('repository persistence failed')
    vi.mocked(getLatestDeploymentForApp).mockResolvedValue({ nais_deployment_id: 'deployment-0' } as never)
    vi.mocked(getDeploymentByNaisId).mockResolvedValue({ monitored_app_id: monitoredApp.id } as never)
    vi.mocked(fetchApplicationDeployments).mockResolvedValue([
      {
        id: 'deployment-1',
        createdAt: '2026-10-10T00:00:00Z',
        environmentName: 'prod-gcp',
        teamSlug: 'team-a',
        triggerUrl: '',
        repository: 'navikt/new-repo',
        commitSha: 'abc123',
        deployerUsername: null,
        resources: { nodes: [] },
      },
    ])
    vi.mocked(findRepositoryForApp).mockResolvedValue({
      repository: null,
      effectiveOwner: 'navikt',
      effectiveRepo: 'new-repo',
      isRedirected: false,
    })
    vi.mocked(getRepositoriesByAppId).mockResolvedValue([
      {
        id: 2,
        monitored_app_id: monitoredApp.id,
        github_owner: 'navikt',
        github_repo_name: 'old-repo',
        github_repo_id: null,
        status: 'active',
        redirects_to_owner: null,
        redirects_to_repo: null,
        notes: null,
        approved_at: null,
        approved_by: 'system',
        created_at: new Date('2026-10-09T00:00:00Z'),
      },
    ])
    vi.mocked(upsertApplicationRepository).mockRejectedValue(error)

    await expect(syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)).rejects.toBe(error)

    expect(createDeployment).not.toHaveBeenCalled()
    expect(markInitialNaisHistorySynced).not.toHaveBeenCalled()
  })

  it('keeps initial history pending when the application is not found in Nais', async () => {
    vi.mocked(fetchApplicationDeployments).mockRejectedValue(
      new NaisDeploymentEnumerationError({ status: 'incomplete', reason: 'application_unavailable' }),
    )

    const result = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)

    expect(result).toEqual({
      newCount: 0,
      alertsCreated: 0,
      stoppedEarly: false,
      initialHistorySyncStatus: 'pending',
      initialHistorySyncReason: 'application_not_found',
    })
    expect(markInitialNaisHistorySynced).not.toHaveBeenCalled()
    expect(updateMonitoredApplication).toHaveBeenCalledWith(monitoredApp.id, { not_found_in_nais_at: expect.any(Date) })
  })

  it('keeps incomplete enumeration errors as failed syncs', async () => {
    const error = new NaisDeploymentEnumerationError({
      status: 'incomplete',
      reason: 'id_count_mismatch',
    })
    vi.mocked(fetchApplicationDeployments).mockRejectedValue(error)

    await expect(syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)).rejects.toBe(error)

    expect(updateMonitoredApplication).not.toHaveBeenCalled()
    expect(markInitialNaisHistorySynced).not.toHaveBeenCalled()
  })

  it.each([
    { inserted: true, alertsCreated: 1 },
    { inserted: false, alertsCreated: 0 },
  ])('counts a repository alert only when it was inserted ($inserted)', async ({ inserted, alertsCreated }) => {
    vi.mocked(fetchApplicationDeployments).mockResolvedValue([
      {
        id: 'deployment-1',
        createdAt: '2026-10-10T00:00:00Z',
        environmentName: 'prod-gcp',
        teamSlug: 'team-a',
        triggerUrl: '',
        repository: 'navikt/new-repo',
        commitSha: 'abc123',
        deployerUsername: null,
        resources: { nodes: [] },
      },
    ])
    vi.mocked(findRepositoryForApp).mockResolvedValue({
      repository: {
        id: 1,
        monitored_app_id: monitoredApp.id,
        github_owner: 'navikt',
        github_repo_name: 'new-repo',
        github_repo_id: null,
        status: 'pending_approval',
        redirects_to_owner: null,
        redirects_to_repo: null,
        notes: null,
        approved_at: null,
        approved_by: null,
        created_at: new Date('2026-10-10T00:00:00Z'),
      },
      effectiveOwner: 'navikt',
      effectiveRepo: 'new-repo',
      isRedirected: false,
    })
    vi.mocked(createRepositoryAlert).mockResolvedValue(inserted)

    const result = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)

    expect(result.alertsCreated).toBe(alertsCreated)
    expect(createRepositoryAlert).toHaveBeenCalledOnce()
  })
})

describe('syncNaisApplyActivityFromNais', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMonitoredApplicationById).mockResolvedValue({ ...monitoredApp, nais_apply_enabled: true })
    vi.mocked(getNaisApplyActivitySyncState).mockResolvedValue(null)
    vi.mocked(saveNaisApplyActivityEvents).mockResolvedValue(1)
    vi.mocked(markNaisApplyActivitySyncComplete).mockResolvedValue(undefined)
    vi.mocked(markNaisApplyActivitySyncFailure).mockResolvedValue(undefined)
  })

  it('fetches all available history page by page on the initial sync', async () => {
    const firstActivity = {
      id: 'activity-1',
      createdAt: '2026-10-13T10:00:00Z',
      actor: 'github-repo:navikt/app-a',
      message: 'Application app-a updated',
      resourceName: 'app-a',
      teamSlug: 'team-a',
      environmentName: 'prod-gcp',
      gitHubActorClaims: null,
      changedFields: [{ field: 'spec.image', oldValue: 'old', newValue: 'new' }],
    }
    const secondActivity = {
      ...firstActivity,
      id: 'activity-2',
      createdAt: '2026-10-13T11:00:00Z',
    }
    vi.mocked(fetchApplicationUpdatedActivityPage)
      .mockResolvedValueOnce({
        nodes: [firstActivity],
        pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
      })
      .mockResolvedValueOnce({
        nodes: [secondActivity],
        pageInfo: { hasNextPage: false, endCursor: 'cursor-2' },
      })
    vi.mocked(saveNaisApplyActivityEvents).mockResolvedValueOnce(1).mockResolvedValueOnce(1)

    const insertedCount = await syncNaisApplyActivityFromNais(monitoredApp.id)

    expect(insertedCount).toBe(2)
    expect(fetchApplicationUpdatedActivityPage).toHaveBeenNthCalledWith(1, 'team-a', 'prod-gcp', 'app-a', null, null)
    expect(fetchApplicationUpdatedActivityPage).toHaveBeenNthCalledWith(
      2,
      'team-a',
      'prod-gcp',
      'app-a',
      'cursor-1',
      null,
    )
    expect(markNaisApplyActivitySyncComplete).toHaveBeenCalledWith(
      monitoredApp.id,
      new Date('2026-10-13T11:00:00Z'),
      true,
    )
    expect(materializeNaisApplyDeployments).toHaveBeenCalledWith(monitoredApp.id, {
      suppressNotifications: true,
      fullHistory: true,
    })
    expect(materializeNaisApplyDeployments.mock.invocationCallOrder[0]).toBeLessThan(
      markNaisApplyActivitySyncComplete.mock.invocationCallOrder[0],
    )
  })

  it('uses an overlap window for incremental polling', async () => {
    vi.mocked(getNaisApplyActivitySyncState).mockResolvedValue({
      last_activity_created_at: new Date('2026-10-14T12:00:00Z'),
      initial_history_synced_at: new Date('2026-10-14T12:00:00Z'),
      last_synced_at: new Date('2026-10-14T12:00:00Z'),
      last_attempt_at: new Date('2026-10-14T12:00:00Z'),
      last_error: null,
    })

    await syncNaisApplyActivityFromNais(monitoredApp.id)

    expect(fetchApplicationUpdatedActivityPage).toHaveBeenCalledWith(
      'team-a',
      'prod-gcp',
      'app-a',
      null,
      '2026-10-07T12:00:00.000Z',
    )
    expect(markNaisApplyActivitySyncComplete).toHaveBeenCalledWith(monitoredApp.id, null, false)
    expect(materializeNaisApplyDeployments).toHaveBeenCalledWith(monitoredApp.id, {
      suppressNotifications: false,
      fullHistory: false,
    })
  })

  it('records failed activity synchronization without marking it complete', async () => {
    const error = new Error('Nais activity API unavailable')
    vi.mocked(fetchApplicationUpdatedActivityPage).mockRejectedValue(error)

    await expect(syncNaisApplyActivityFromNais(monitoredApp.id)).rejects.toBe(error)

    expect(markNaisApplyActivitySyncFailure).toHaveBeenCalledWith(monitoredApp.id, error.message)
    expect(markNaisApplyActivitySyncComplete).not.toHaveBeenCalled()
  })

  it('does not query the activity log when opt-in is disabled', async () => {
    vi.mocked(getMonitoredApplicationById).mockResolvedValue(monitoredApp)

    await expect(syncNaisApplyActivityFromNais(monitoredApp.id)).resolves.toBe(0)

    expect(getNaisApplyActivitySyncState).not.toHaveBeenCalled()
    expect(fetchApplicationUpdatedActivityPage).not.toHaveBeenCalled()
    expect(markNaisApplyActivitySyncComplete).not.toHaveBeenCalled()
  })

  it('does not advance history when the app scope does not match the activity', async () => {
    vi.mocked(fetchApplicationUpdatedActivityPage).mockResolvedValue({
      nodes: [
        {
          id: 'activity-1',
          createdAt: '2026-10-13T10:00:00Z',
          actor: 'manual',
          message: 'Application app-a updated',
          resourceName: 'another-app',
          teamSlug: 'team-a',
          environmentName: 'prod-gcp',
          gitHubActorClaims: null,
          changedFields: [],
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    })

    await expect(syncNaisApplyActivityFromNais(monitoredApp.id)).rejects.toThrow(
      'Unexpected Nais activity resource for monitored application',
    )

    expect(saveNaisApplyActivityEvents).not.toHaveBeenCalled()
    expect(markNaisApplyActivitySyncComplete).not.toHaveBeenCalled()
  })

  it('does not advance history when pagination is incomplete', async () => {
    vi.mocked(fetchApplicationUpdatedActivityPage).mockResolvedValue({
      nodes: [],
      pageInfo: { hasNextPage: true, endCursor: null },
    })

    await expect(syncNaisApplyActivityFromNais(monitoredApp.id)).rejects.toThrow(
      'Nais activity page is missing its cursor',
    )

    expect(markNaisApplyActivitySyncComplete).not.toHaveBeenCalled()
  })
})
