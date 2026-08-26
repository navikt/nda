import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireAdmin,
  mockGetMonitoredApplicationById,
  mockUpdateMonitoredApplication,
  mockRecordAppConfigAuditLog,
} = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetMonitoredApplicationById: vi.fn(),
  mockUpdateMonitoredApplication: vi.fn(),
  mockRecordAppConfigAuditLog: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({ requireAdmin: mockRequireAdmin }))

vi.mock('~/db/app-settings.server', () => ({
  recordAppConfigAuditLog: mockRecordAppConfigAuditLog,
  SLACK_CONFIG_SETTING_KEYS: ['slack_notifications_enabled', 'slack_deploy_notify_enabled'],
  updateImplicitApprovalSettings: vi.fn(),
}))

vi.mock('~/db/audit-reports.server', () => ({
  archiveAuditReport: vi.fn(),
  checkAuditReadiness: vi.fn(),
  hasActiveReportForPeriod: vi.fn(),
  restoreAuditReport: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn({}),
}))

vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationById: mockGetMonitoredApplicationById,
  getMonitoredApplicationByIdentity: vi.fn(),
  updateMonitoredApplication: mockUpdateMonitoredApplication,
}))

vi.mock('~/db/report-jobs.server', () => ({
  createReportJob: vi.fn(),
  isStaleJob: vi.fn(),
}))

vi.mock('~/db/sync-jobs.server', () => ({
  acquireSyncLock: vi.fn(),
  cancelSyncJob: vi.fn(),
  forceReleaseSyncJob: vi.fn(),
  getLatestSyncJob: vi.fn(),
  getSyncJobById: vi.fn(),
  getSyncJobOptions: vi.fn(),
  heartbeatSyncJob: vi.fn(),
  releaseSyncLock: vi.fn(),
  SYNC_INTERVAL_MS: 60_000,
  updateSyncJobProgress: vi.fn(),
}))

vi.mock('~/db/user-github-lookups.server', () => ({ getGithubUserLookups: vi.fn() }))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  runWithJobContext: vi.fn(),
}))

vi.mock('~/lib/report-job-processor.server', () => ({ processReportJobAsync: vi.fn() }))
vi.mock('~/lib/user-display', () => ({ serializeUserLookups: vi.fn() }))
vi.mock('~/lib/verification', () => ({ fetchVerificationDataForAllDeployments: vi.fn() }))
vi.mock('~/lib/verification/compute-diffs.server', () => ({ computeVerificationDiffs: vi.fn() }))

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value)
  }
  return formData
}

function buildRequest(fields: Record<string, string>): Request {
  return {
    formData: async () => buildFormData(fields),
  } as unknown as Request
}

describe('admin actions - Slack config toggles', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRequireAdmin.mockReset()
    mockGetMonitoredApplicationById.mockReset()
    mockUpdateMonitoredApplication.mockReset()
    mockRecordAppConfigAuditLog.mockReset()
    mockRequireAdmin.mockResolvedValue({ navIdent: 'Z990001', name: 'Glad Fjord', role: 'admin', isActualAdmin: true })
    mockUpdateMonitoredApplication.mockResolvedValue(undefined)
  })

  async function getAction() {
    const mod = await import('../$team.env.$env.app.$app.admin.actions.server')
    return mod.action
  }

  it('records an audit log entry when approval notifications are toggled on', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue({
      slack_notifications_enabled: false,
      slack_channel_id: null,
    })
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'update_slack_config',
        app_id: '42',
        slack_notifications_enabled: 'true',
        slack_channel_id: 'C0123456',
      }),
      params: {},
    })

    expect(result).toEqual({ success: 'Slack-innstillinger oppdatert!' })
    expect(mockRecordAppConfigAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        monitoredAppId: 42,
        settingKey: 'slack_notifications_enabled',
        oldValue: { enabled: false, channel_id: null },
        newValue: { enabled: true, channel_id: 'C0123456' },
        changedByNavIdent: 'Z990001',
        changedByName: 'Glad Fjord',
      }),
      expect.anything(),
    )
  })

  it('records an audit log entry when deploy notifications are toggled off', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue({
      slack_deploy_notify_enabled: true,
      slack_deploy_channel_id: 'C0DEPLOY1',
    })
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'update_slack_deploy_config',
        app_id: '42',
        slack_deploy_notify_enabled: 'false',
        slack_deploy_channel_id: 'C0DEPLOY1',
      }),
      params: {},
    })

    expect(result).toEqual({ success: 'Deployment-varsler oppdatert!' })
    expect(mockRecordAppConfigAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        monitoredAppId: 42,
        settingKey: 'slack_deploy_notify_enabled',
        oldValue: { enabled: true, channel_id: 'C0DEPLOY1' },
        newValue: { enabled: false, channel_id: 'C0DEPLOY1' },
      }),
      expect.anything(),
    )
  })

  it('does not record an audit log entry when the enabled flag is unchanged', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue({
      slack_notifications_enabled: true,
      slack_channel_id: 'C0123456',
    })
    const action = await getAction()

    await action({
      request: buildRequest({
        action: 'update_slack_config',
        app_id: '42',
        slack_notifications_enabled: 'true',
        slack_channel_id: 'C0999999',
      }),
      params: {},
    })

    expect(mockRecordAppConfigAuditLog).not.toHaveBeenCalled()
  })

  it('returns an error and does not update or log when the app is not found (approval config)', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue(null)
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'update_slack_config',
        app_id: '42',
        slack_notifications_enabled: 'true',
        slack_channel_id: 'C0123456',
      }),
      params: {},
    })

    expect(result).toEqual({ error: 'Fant ikke applikasjonen' })
    expect(mockUpdateMonitoredApplication).not.toHaveBeenCalled()
    expect(mockRecordAppConfigAuditLog).not.toHaveBeenCalled()
  })

  it('returns an error and does not update or log when the app is not found (deploy config)', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue(null)
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'update_slack_deploy_config',
        app_id: '42',
        slack_deploy_notify_enabled: 'true',
        slack_deploy_channel_id: 'C0DEPLOY1',
      }),
      params: {},
    })

    expect(result).toEqual({ error: 'Fant ikke applikasjonen' })
    expect(mockUpdateMonitoredApplication).not.toHaveBeenCalled()
    expect(mockRecordAppConfigAuditLog).not.toHaveBeenCalled()
  })
})
