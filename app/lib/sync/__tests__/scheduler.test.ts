import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cleanupOldSnapshots,
  withSyncClient,
  getAllMonitoredApplications,
  cleanupOldSyncJobs,
  syncRepositoryCodeDeliveries,
  reverifyPendingChecks,
  verifyDeploymentsFourEyes,
  cacheCheckLogsWithLock,
  syncNaisApplyActivityFromNais,
  syncNewDeploymentsFromNais,
  withSyncLock,
  loggerError,
} = vi.hoisted(() => ({
  cleanupOldSnapshots: vi.fn(),
  withSyncClient: vi.fn(),
  getAllMonitoredApplications: vi.fn(),
  cleanupOldSyncJobs: vi.fn(),
  syncRepositoryCodeDeliveries: vi.fn(),
  reverifyPendingChecks: vi.fn(),
  verifyDeploymentsFourEyes: vi.fn(),
  cacheCheckLogsWithLock: vi.fn(),
  syncNaisApplyActivityFromNais: vi.fn(),
  syncNewDeploymentsFromNais: vi.fn(),
  withSyncLock: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('~/db/connection.server', () => ({ withSyncClient }))
vi.mock('~/db/github-data.server', () => ({ cleanupOldSnapshots }))
vi.mock('~/db/monitored-applications.server', () => ({ getAllMonitoredApplications }))
vi.mock('~/db/sync-jobs.server', () => ({ cleanupOldSyncJobs, SYNC_INTERVAL_MS: 1000 }))
vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: loggerError },
}))
vi.mock('../code-delivery-sync.server', () => ({ syncRepositoryCodeDeliveries }))
vi.mock('../github-verify.server', () => ({
  CHECKS_REVERIFY_LIMIT_PER_APP: 10,
  reverifyPendingChecks,
  verifyDeploymentsFourEyes,
}))
vi.mock('../log-cache-job.server', () => ({ cacheCheckLogsWithLock }))
vi.mock('../nais-sync.server', () => ({ syncNaisApplyActivityFromNais, syncNewDeploymentsFromNais }))
vi.mock('../with-sync-lock.server', () => ({ withSyncLock }))
vi.mock('~/lib/slack/client.server', () => ({ sendPendingDeployNotifications: vi.fn().mockResolvedValue(0) }))

import { runPeriodicSync, syncNewDeploymentsWithLock } from '../scheduler.server'

afterEach(() => {
  vi.useRealTimers()
})

describe('syncNewDeploymentsWithLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(withSyncClient).mockImplementation(async (run) => run())
    vi.mocked(withSyncLock).mockImplementation(async (_type, _appId, _options, run) => ({
      success: true,
      result: await run(),
    }))
    vi.mocked(syncNewDeploymentsFromNais).mockResolvedValue({
      newCount: 2,
      alertsCreated: 0,
      stoppedEarly: false,
    })
    vi.mocked(syncNaisApplyActivityFromNais).mockResolvedValue(3)
    vi.mocked(getAllMonitoredApplications).mockResolvedValue([])
    vi.mocked(cleanupOldSyncJobs).mockResolvedValue(0)
    vi.mocked(cleanupOldSnapshots).mockResolvedValue({ counts: {}, truncated: false })
    vi.mocked(syncRepositoryCodeDeliveries).mockResolvedValue(undefined)
    vi.mocked(verifyDeploymentsFourEyes).mockResolvedValue({ verified: 0, failed: 0, skipped: 0, remaining: 0 })
    vi.mocked(reverifyPendingChecks).mockResolvedValue({ fetched: 0, errors: 0 })
    vi.mocked(cacheCheckLogsWithLock).mockResolvedValue({ cached: 0 })
  })

  it('runs legacy and Apply synchronization sequentially', async () => {
    const order: string[] = []
    vi.mocked(syncNewDeploymentsFromNais).mockImplementation(async () => {
      order.push('legacy')
      return { newCount: 2, alertsCreated: 0, stoppedEarly: false }
    })
    vi.mocked(syncNaisApplyActivityFromNais).mockImplementation(async () => {
      order.push('apply')
      return 3
    })

    const result = await syncNewDeploymentsWithLock(7, 'team', 'prod', 'app')

    expect(order).toEqual(['legacy', 'apply'])
    expect(result).toMatchObject({
      success: true,
      result: { newCount: 2, naisApplyActivityCount: 3 },
    })
  })

  it('attempts Apply synchronization even if legacy synchronization fails', async () => {
    const legacyError = new Error('legacy failed')
    vi.mocked(syncNewDeploymentsFromNais).mockRejectedValue(legacyError)

    await expect(syncNewDeploymentsWithLock(7, 'team', 'prod', 'app')).rejects.toBe(legacyError)

    expect(syncNaisApplyActivityFromNais).toHaveBeenCalledOnce()
  })

  it('continues with legacy results when Apply synchronization fails', async () => {
    vi.mocked(syncNaisApplyActivityFromNais).mockRejectedValue(new Error('Apply failed'))

    await expect(syncNewDeploymentsWithLock(7, 'team', 'prod', 'app')).resolves.toMatchObject({
      success: true,
      result: { newCount: 2, naisApplyActivityCount: 0 },
    })

    expect(loggerError).toHaveBeenCalledOnce()
  })

  it('continues verification after legacy fails and Apply sync succeeds', async () => {
    vi.mocked(getAllMonitoredApplications).mockResolvedValue([
      { id: 7, team_slug: 'team', environment_name: 'prod', app_name: 'app' } as never,
    ])
    vi.mocked(syncNewDeploymentsFromNais).mockRejectedValue(new Error('legacy failed'))
    vi.useFakeTimers()

    const run = runPeriodicSync()
    await vi.runAllTimersAsync()
    await run

    expect(syncNaisApplyActivityFromNais).toHaveBeenCalledOnce()
    expect(verifyDeploymentsFourEyes).toHaveBeenCalledWith({ monitored_app_id: 7, limit: 50 })
    expect(reverifyPendingChecks).toHaveBeenCalledWith(7, 10)
    expect(cacheCheckLogsWithLock).toHaveBeenCalledWith(7)
  })
})
