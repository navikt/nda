import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toDateString } from '~/lib/date-utils'

const {
  mockRequireUser,
  mockCanAccessAppAdmin,
  mockGetMonitoredApplicationById,
  mockUpdateMonitoredApplication,
  mockRecordAppConfigAuditLog,
  mockGetEffectiveAuditStartYear,
  mockCheckAuditReadiness,
  mockHasActiveReportForPeriod,
  mockCreateReportJob,
  mockProcessReportJobAsync,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCanAccessAppAdmin: vi.fn(),
  mockGetMonitoredApplicationById: vi.fn(),
  mockUpdateMonitoredApplication: vi.fn(),
  mockRecordAppConfigAuditLog: vi.fn(),
  mockGetEffectiveAuditStartYear: vi.fn(),
  mockCheckAuditReadiness: vi.fn(),
  mockHasActiveReportForPeriod: vi.fn(),
  mockCreateReportJob: vi.fn(),
  mockProcessReportJobAsync: vi.fn(),
}))

vi.mock('~/lib/auth.server', () => ({ requireUser: mockRequireUser }))

vi.mock('~/lib/authorization.server', () => ({ canAccessAppAdmin: mockCanAccessAppAdmin }))

vi.mock('~/db/app-settings.server', () => ({
  recordAppConfigAuditLog: mockRecordAppConfigAuditLog,
}))

vi.mock('~/db/audit-reports.server', () => ({
  archiveAuditReport: vi.fn(),
  checkAuditReadiness: mockCheckAuditReadiness,
  hasActiveReportForPeriod: mockHasActiveReportForPeriod,
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

vi.mock('~/db/repositories.server', () => ({
  getEffectiveAuditStartYear: mockGetEffectiveAuditStartYear,
}))

vi.mock('~/db/report-jobs.server', () => ({
  createReportJob: mockCreateReportJob,
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

vi.mock('~/lib/report-job-processor.server', () => ({ processReportJobAsync: mockProcessReportJobAsync }))
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
    mockRequireUser.mockReset()
    mockCanAccessAppAdmin.mockReset()
    mockGetMonitoredApplicationById.mockReset()
    mockUpdateMonitoredApplication.mockReset()
    mockRecordAppConfigAuditLog.mockReset()
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990001', name: 'Glad Fjord', role: 'admin', isActualAdmin: true })
    mockCanAccessAppAdmin.mockResolvedValue(true)
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

  it('does not record an audit log entry when nothing changed', async () => {
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
        slack_channel_id: 'C0123456',
      }),
      params: {},
    })

    expect(mockRecordAppConfigAuditLog).not.toHaveBeenCalled()
  })

  it('records an audit log entry when only the channel changes and the enabled flag is unchanged', async () => {
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

    expect(mockRecordAppConfigAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValue: { enabled: true, channel_id: 'C0123456' },
        newValue: { enabled: true, channel_id: 'C0999999' },
      }),
      expect.anything(),
    )
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

  it('records an audit log entry when the reminder Slack channel is changed', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue({
      reminder_enabled: true,
      reminder_channel_id: 'C0OLDCHAN',
    })
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'update_reminder_config',
        app_id: '42',
        reminder_enabled: 'true',
        reminder_channel_id: 'C0NEWCHAN',
        reminder_time: '09:00',
      }),
      params: {},
    })

    expect(result).toEqual({ success: 'Purre-innstillinger oppdatert!' })
    expect(mockRecordAppConfigAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        monitoredAppId: 42,
        settingKey: 'reminder_enabled',
        oldValue: { enabled: true, channel_id: 'C0OLDCHAN' },
        newValue: { enabled: true, channel_id: 'C0NEWCHAN' },
      }),
      expect.anything(),
    )
    expect(mockUpdateMonitoredApplication).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ reminder_time: '09:00' }),
      expect.anything(),
    )
  })

  it('rejects an invalid reminder Slack channel format', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue({
      reminder_enabled: false,
      reminder_channel_id: null,
    })
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'update_reminder_config',
        app_id: '42',
        reminder_enabled: 'true',
        reminder_channel_id: 'not a channel!',
        reminder_time: '09:00',
      }),
      params: {},
    })

    expect(result).toEqual({
      error: 'Ugyldig kanal-format. Bruk kanal-ID (C01234567) eller kanalnavn (#kanal-navn)',
    })
    expect(mockUpdateMonitoredApplication).not.toHaveBeenCalled()
    expect(mockRecordAppConfigAuditLog).not.toHaveBeenCalled()
  })
})

describe('admin actions - audit report scope validation', () => {
  beforeEach(() => {
    vi.resetModules()
    mockRequireUser.mockReset()
    mockCanAccessAppAdmin.mockReset()
    mockGetMonitoredApplicationById.mockReset()
    mockGetEffectiveAuditStartYear.mockReset()
    mockCheckAuditReadiness.mockReset()
    mockHasActiveReportForPeriod.mockReset()
    mockCreateReportJob.mockReset()
    mockProcessReportJobAsync.mockReset()
    mockProcessReportJobAsync.mockResolvedValue(undefined)
    mockRequireUser.mockResolvedValue({ navIdent: 'Z990001', name: 'Glad Fjord', role: 'admin', isActualAdmin: true })
    mockCanAccessAppAdmin.mockResolvedValue(true)
    mockGetMonitoredApplicationById.mockResolvedValue({ id: 42, environment_name: 'prod-gcp' })
    mockGetEffectiveAuditStartYear.mockResolvedValue(2024)
  })

  async function getAction() {
    const mod = await import('../$team.env.$env.app.$app.admin.actions.server')
    return mod.action
  }

  it('rejects check_readiness when periodStart is after periodEnd', async () => {
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'check_readiness',
        app_id: '42',
        period_type: 'custom',
        period_start: '2026-06-01',
        period_end: '2026-01-01',
      }),
      params: {},
    })

    expect(result).toEqual({ error: 'Ugyldig periode: fra-dato kan ikke være etter til-dato' })
    expect(mockCheckAuditReadiness).not.toHaveBeenCalled()
  })

  it('rejects check_readiness for a non-production app environment', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue({ id: 42, environment_name: 'dev-gcp' })
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'check_readiness',
        app_id: '42',
        period_type: 'yearly',
        period_start: '2026-01-01',
        period_end: '2026-12-31',
      }),
      params: {},
    })

    expect(result).toEqual({
      error: 'Leveranserapporter kan kun genereres for produksjonsmiljøer (prod-fss, prod-gcp)',
    })
    expect(mockCheckAuditReadiness).not.toHaveBeenCalled()
  })

  it('rejects check_readiness for a period before the effective audit start year', async () => {
    mockGetEffectiveAuditStartYear.mockResolvedValue(2026)
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'check_readiness',
        app_id: '42',
        period_type: 'yearly',
        period_start: '2025-01-01',
        period_end: '2025-12-31',
      }),
      params: {},
    })

    expect(result).toEqual({ error: 'Perioden starter før appens revisjonsstartår (2026)' })
    expect(mockCheckAuditReadiness).not.toHaveBeenCalled()
  })

  it('allows check_readiness for a valid production period within the audit start year', async () => {
    mockCheckAuditReadiness.mockResolvedValue({
      is_ready: true,
      no_deployments: true,
      total_deployments: 0,
      approved_count: 0,
      legacy_count: 0,
      unverifiable_count: 0,
      pending_count: 0,
      pending_deployments: [],
      unverifiable_deployments: [],
      missing_approver_count: 0,
      missing_approver_deployments: [],
      manual_trigger_count: 0,
      manual_trigger_deployments: [],
    })
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'check_readiness',
        app_id: '42',
        period_type: 'yearly',
        period_start: '2025-01-01',
        period_end: '2025-12-31',
      }),
      params: {},
    })

    expect(mockCheckAuditReadiness).toHaveBeenCalledWith(42, expect.any(Date), expect.any(Date))
    expect(result).toMatchObject({ readiness: expect.objectContaining({ is_ready: true, no_deployments: true }) })
  })

  it('rejects generate_report when periodStart is after periodEnd without creating a job', async () => {
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'generate_report',
        app_id: '42',
        period_type: 'custom',
        period_label: 'Custom',
        period_start: '2026-06-01',
        period_end: '2026-01-01',
        year: '2026',
      }),
      params: {},
    })

    expect(result).toEqual({ error: 'Ugyldig periode: fra-dato kan ikke være etter til-dato' })
    expect(mockCheckAuditReadiness).not.toHaveBeenCalled()
    expect(mockCreateReportJob).not.toHaveBeenCalled()
  })

  it('rejects generate_report for a non-production app environment without creating a job', async () => {
    mockGetMonitoredApplicationById.mockResolvedValue({ id: 42, environment_name: 'dev-gcp' })
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'generate_report',
        app_id: '42',
        period_type: 'yearly',
        period_label: '2025',
        period_start: '2025-01-01',
        period_end: '2025-12-31',
        year: '2025',
      }),
      params: {},
    })

    expect(result).toEqual({
      error: 'Leveranserapporter kan kun genereres for produksjonsmiljøer (prod-fss, prod-gcp)',
    })
    expect(mockCheckAuditReadiness).not.toHaveBeenCalled()
    expect(mockCreateReportJob).not.toHaveBeenCalled()
  })

  it('rejects generate_report for a period before the effective audit start year without creating a job', async () => {
    mockGetEffectiveAuditStartYear.mockResolvedValue(2026)
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'generate_report',
        app_id: '42',
        period_type: 'yearly',
        period_label: '2025',
        period_start: '2025-01-01',
        period_end: '2025-12-31',
        year: '2025',
      }),
      params: {},
    })

    expect(result).toEqual({ error: 'Perioden starter før appens revisjonsstartår (2026)' })
    expect(mockCheckAuditReadiness).not.toHaveBeenCalled()
    expect(mockCreateReportJob).not.toHaveBeenCalled()
  })

  it('ignores a forged narrow period_end and re-derives the full canonical year boundaries for generate_report', async () => {
    mockCheckAuditReadiness.mockResolvedValue({
      is_ready: true,
      no_deployments: true,
      total_deployments: 0,
      approved_count: 0,
      legacy_count: 0,
      unverifiable_count: 0,
      pending_count: 0,
      pending_deployments: [],
      unverifiable_deployments: [],
      missing_approver_count: 0,
      missing_approver_deployments: [],
      manual_trigger_count: 0,
      manual_trigger_deployments: [],
    })
    mockHasActiveReportForPeriod.mockResolvedValue(false)
    mockCreateReportJob.mockResolvedValue({ created: true, jobId: 'job-1', status: 'pending' })
    const action = await getAction()

    await action({
      request: buildRequest({
        action: 'generate_report',
        app_id: '42',
        period_type: 'yearly',
        period_label: '2025',
        period_start: '2025-01-01',
        period_end: '2025-01-02',
        year: '2025',
      }),
      params: {},
    })

    expect(mockCheckAuditReadiness).toHaveBeenCalledTimes(1)
    const [, readinessStart, readinessEnd] = mockCheckAuditReadiness.mock.calls[0]
    expect(toDateString(readinessStart)).toBe('2025-01-01')
    expect(toDateString(readinessEnd)).toBe('2025-12-31')

    expect(mockCreateReportJob).toHaveBeenCalledTimes(1)
    const [, , , , , createJobEnd] = mockCreateReportJob.mock.calls[0]
    expect(toDateString(createJobEnd)).toBe('2025-12-31')
  })

  it('rejects a custom period that does not cover whole calendar months', async () => {
    const action = await getAction()

    const result = await action({
      request: buildRequest({
        action: 'generate_report',
        app_id: '42',
        period_type: 'custom',
        period_label: 'Egendefinert',
        period_start: '2025-01-05',
        period_end: '2025-01-31',
        year: '2025',
      }),
      params: {},
    })

    expect(result).toEqual({ error: 'Egendefinert periode må dekke hele kalendermåneder' })
    expect(mockCheckAuditReadiness).not.toHaveBeenCalled()
    expect(mockCreateReportJob).not.toHaveBeenCalled()
  })
})
