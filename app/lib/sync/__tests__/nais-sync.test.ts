import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitoredApplication } from '~/db/monitored-applications.server'

const {
  createRepositoryAlert,
  createDeployment,
  fetchApplicationDeployments,
  fetchNewDeployments,
  findRepositoryForApp,
  getDeploymentByNaisId,
  getLatestDeploymentForApp,
  getMonitoredApplicationById,
  getMonitoredApplicationByIdentity,
  getRepositoriesByAppId,
  logger,
  markInitialNaisHistorySyncStarted,
  markInitialNaisHistorySynced,
  syncDefaultBranchForApp,
  updateMonitoredApplication,
  upsertApplicationRepository,
} = vi.hoisted(() => ({
  createRepositoryAlert: vi.fn(),
  createDeployment: vi.fn(),
  fetchApplicationDeployments: vi.fn(),
  fetchNewDeployments: vi.fn(),
  findRepositoryForApp: vi.fn(),
  getDeploymentByNaisId: vi.fn(),
  getLatestDeploymentForApp: vi.fn(),
  getMonitoredApplicationById: vi.fn(),
  getMonitoredApplicationByIdentity: vi.fn(),
  getRepositoriesByAppId: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  markInitialNaisHistorySyncStarted: vi.fn(),
  markInitialNaisHistorySynced: vi.fn(),
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
vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationById,
  getMonitoredApplicationByIdentity,
  markInitialNaisHistorySyncStarted,
  markInitialNaisHistorySynced,
  updateMonitoredApplication,
}))
vi.mock('~/lib/logger.server', () => ({ logger }))
vi.mock('~/lib/nais.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/nais.server')>()
  return { ...actual, fetchApplicationDeployments, fetchNewDeployments }
})
vi.mock('../default-branch-sync.server', () => ({ syncDefaultBranchForApp }))

import { NaisDeploymentEnumerationError } from '~/lib/nais.server'
import { syncNewDeploymentsFromNais } from '../nais-sync.server'

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
  initial_nais_history_sync_started_at: null,
  initial_nais_history_synced_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
}

describe('syncNewDeploymentsFromNais initial full sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLatestDeploymentForApp).mockResolvedValue(null)
    vi.mocked(getMonitoredApplicationByIdentity).mockResolvedValue(monitoredApp)
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
    expect(markInitialNaisHistorySyncStarted).not.toHaveBeenCalled()
    expect(markInitialNaisHistorySynced).not.toHaveBeenCalled()
  })

  it('records initial history sync start before processing and completion after a complete full enumeration', async () => {
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

    expect(result).toEqual({ newCount: 1, alertsCreated: 0, stoppedEarly: false })
    expect(createDeployment).toHaveBeenCalledOnce()
    expect(markInitialNaisHistorySyncStarted).toHaveBeenCalledOnce()
    expect(markInitialNaisHistorySyncStarted).toHaveBeenCalledWith(monitoredApp.id)
    expect(markInitialNaisHistorySynced).toHaveBeenCalledOnce()
    expect(markInitialNaisHistorySynced).toHaveBeenCalledWith(monitoredApp.id)
    expect(markInitialNaisHistorySyncStarted.mock.invocationCallOrder[0]).toBeLessThan(
      createDeployment.mock.invocationCallOrder[0],
    )
    expect(createDeployment.mock.invocationCallOrder[0]).toBeLessThan(
      markInitialNaisHistorySynced.mock.invocationCallOrder[0],
    )
  })

  it('retries an incomplete initial full sync instead of switching to incremental sync', async () => {
    const deployments = ['deployment-1', 'deployment-2'].map((id) => ({
      id,
      createdAt: '2026-10-10T00:00:00Z',
      environmentName: 'prod-gcp',
      teamSlug: 'team-a',
      triggerUrl: '',
      repository: null,
      commitSha: null,
      deployerUsername: null,
      resources: { nodes: [] },
    }))
    vi.mocked(fetchApplicationDeployments).mockResolvedValue(deployments)
    vi.mocked(getLatestDeploymentForApp)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        nais_deployment_id: 'deployment-1',
      } as Awaited<ReturnType<typeof getLatestDeploymentForApp>>)
    vi.mocked(getMonitoredApplicationById).mockResolvedValue({
      ...monitoredApp,
      initial_nais_history_sync_started_at: new Date('2026-10-10T00:00:00Z'),
    })
    const persistedDeployments = new Set<string>()
    let shouldFailDeployment2 = true
    vi.mocked(getDeploymentByNaisId).mockImplementation(async (id) =>
      persistedDeployments.has(id)
        ? ({ nais_deployment_id: id } as Awaited<ReturnType<typeof getDeploymentByNaisId>>)
        : null,
    )
    vi.mocked(createDeployment).mockImplementation(async ({ naisDeploymentId }) => {
      if (naisDeploymentId === 'deployment-2' && shouldFailDeployment2) {
        shouldFailDeployment2 = false
        throw new Error('partial import failed')
      }
      persistedDeployments.add(naisDeploymentId)
      return undefined as never
    })

    await expect(syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)).rejects.toThrow(
      'partial import failed',
    )
    expect(markInitialNaisHistorySyncStarted).toHaveBeenCalledOnce()
    expect(markInitialNaisHistorySynced).not.toHaveBeenCalled()

    const result = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)

    expect(result).toEqual({ newCount: 1, alertsCreated: 0, stoppedEarly: false })
    expect(fetchApplicationDeployments).toHaveBeenCalledTimes(2)
    expect(fetchNewDeployments).not.toHaveBeenCalled()
    expect(markInitialNaisHistorySyncStarted).toHaveBeenCalledTimes(2)
    expect(markInitialNaisHistorySynced).toHaveBeenCalledOnce()
  })

  it('keeps existing applications without an initial sync marker on the incremental path', async () => {
    vi.mocked(getLatestDeploymentForApp).mockResolvedValue({
      nais_deployment_id: 'existing-deployment',
    } as Awaited<ReturnType<typeof getLatestDeploymentForApp>>)
    vi.mocked(getMonitoredApplicationById).mockResolvedValue(monitoredApp)
    vi.mocked(fetchNewDeployments).mockResolvedValue({ deployments: [], stoppedEarly: false })

    const result = await syncNewDeploymentsFromNais('team-a', 'prod-gcp', 'app-a', monitoredApp.id)

    expect(result).toEqual({ newCount: 0, alertsCreated: 0, stoppedEarly: false })
    expect(fetchApplicationDeployments).not.toHaveBeenCalled()
    expect(fetchNewDeployments).toHaveBeenCalledOnce()
  })
})
