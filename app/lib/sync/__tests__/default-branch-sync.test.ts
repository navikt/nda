import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('~/db/monitored-applications.server', () => ({
  updateMonitoredApplication: vi.fn(),
}))

vi.mock('~/lib/github/git.server', () => ({
  getRepositoryDefaultBranch: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { updateMonitoredApplication } from '~/db/monitored-applications.server'
import { getRepositoryDefaultBranch } from '~/lib/github/git.server'
import { syncDefaultBranchForApp } from '../default-branch-sync.server'

describe('syncDefaultBranchForApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('skips when last sync was within cooldown (24h)', async () => {
    const recentSync = new Date(Date.now() - 1 * 60 * 60 * 1000)

    await syncDefaultBranchForApp({
      monitoredAppId: 1,
      appName: 'my-app',
      currentDefaultBranch: 'main',
      defaultBranchSyncedAt: recentSync,
      owner: 'navikt',
      repo: 'my-app',
    })

    expect(getRepositoryDefaultBranch).not.toHaveBeenCalled()
    expect(updateMonitoredApplication).not.toHaveBeenCalled()
  })

  test('runs when last sync was over 24h ago', async () => {
    const oldSync = new Date(Date.now() - 25 * 60 * 60 * 1000)
    vi.mocked(getRepositoryDefaultBranch).mockResolvedValue('main')

    await syncDefaultBranchForApp({
      monitoredAppId: 1,
      appName: 'my-app',
      currentDefaultBranch: 'main',
      defaultBranchSyncedAt: oldSync,
      owner: 'navikt',
      repo: 'my-app',
    })

    expect(getRepositoryDefaultBranch).toHaveBeenCalledWith('navikt', 'my-app')
    expect(updateMonitoredApplication).toHaveBeenCalledWith(1, {
      default_branch_synced_at: expect.any(Date),
    })
  })

  test('runs when never synced before (null)', async () => {
    vi.mocked(getRepositoryDefaultBranch).mockResolvedValue('master')

    await syncDefaultBranchForApp({
      monitoredAppId: 1,
      appName: 'my-app',
      currentDefaultBranch: 'main',
      defaultBranchSyncedAt: null,
      owner: 'navikt',
      repo: 'my-app',
    })

    expect(getRepositoryDefaultBranch).toHaveBeenCalled()
    expect(updateMonitoredApplication).toHaveBeenCalledWith(1, {
      default_branch: 'master',
      default_branch_synced_at: expect.any(Date),
    })
  })

  test('updates default_branch when GitHub differs from configured', async () => {
    vi.mocked(getRepositoryDefaultBranch).mockResolvedValue('master')

    await syncDefaultBranchForApp({
      monitoredAppId: 42,
      appName: 'legacy-app',
      currentDefaultBranch: 'main',
      defaultBranchSyncedAt: null,
      owner: 'navikt',
      repo: 'legacy-app',
    })

    expect(updateMonitoredApplication).toHaveBeenCalledWith(42, {
      default_branch: 'master',
      default_branch_synced_at: expect.any(Date),
    })
  })

  test('only updates synced_at when default_branch already correct', async () => {
    vi.mocked(getRepositoryDefaultBranch).mockResolvedValue('main')

    await syncDefaultBranchForApp({
      monitoredAppId: 1,
      appName: 'my-app',
      currentDefaultBranch: 'main',
      defaultBranchSyncedAt: null,
      owner: 'navikt',
      repo: 'my-app',
    })

    expect(updateMonitoredApplication).toHaveBeenCalledWith(1, {
      default_branch_synced_at: expect.any(Date),
    })
  })

  test('persists synced_at even on GitHub fetch failure (enforce cooldown)', async () => {
    vi.mocked(getRepositoryDefaultBranch).mockResolvedValue(null)

    await syncDefaultBranchForApp({
      monitoredAppId: 1,
      appName: 'my-app',
      currentDefaultBranch: 'main',
      defaultBranchSyncedAt: null,
      owner: 'navikt',
      repo: 'my-app',
    })

    expect(updateMonitoredApplication).toHaveBeenCalledWith(1, {
      default_branch_synced_at: expect.any(Date),
    })
  })
})
