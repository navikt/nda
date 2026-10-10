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
  })
})
