import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAdmin, mockResetNaisHistorySyncMarker, mockGetCompletedNaisSyncsInWindow } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetCompletedNaisSyncsInWindow: vi.fn(),
  mockResetNaisHistorySyncMarker: vi.fn(),
}))
const mockInfo = vi.hoisted(() => vi.fn())

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('~/db/monitored-applications.server', () => ({
  getNaisHistoryRecoveryCandidates: vi.fn().mockResolvedValue([]),
  getCompletedNaisSyncsInWindow: mockGetCompletedNaisSyncsInWindow,
  resetNaisHistorySyncMarker: mockResetNaisHistorySyncMarker,
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: mockInfo, error: vi.fn() },
}))

import { action, loader } from './nais-history-recovery'

function makeRequest(entries: Record<string, string>): Request {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value)
  }
  return new Request('http://localhost/admin/nais-history-recovery', { method: 'POST', body: formData })
}

describe('Nais history recovery action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ navIdent: 'Z990001' })
  })

  it('requires explicit confirmation before resetting a marker', async () => {
    const result = await action({
      request: makeRequest({ intent: 'reset_history_marker', id: '12' }),
    } as never)

    expect(result).toEqual({ error: 'Bekreft at applikasjonen skal hente hele Nais-historikken på nytt.' })
    expect(mockResetNaisHistorySyncMarker).not.toHaveBeenCalled()
  })

  it('rejects non-admin users before performing the reset', async () => {
    mockRequireAdmin.mockRejectedValue(new Response('Forbidden', { status: 403 }))

    await expect(
      action({
        request: makeRequest({ intent: 'reset_history_marker', id: '12', confirmed: 'yes' }),
      } as never),
    ).rejects.toMatchObject({ status: 403 })

    expect(mockResetNaisHistorySyncMarker).not.toHaveBeenCalled()
  })

  it('resets one confirmed application marker', async () => {
    mockResetNaisHistorySyncMarker.mockResolvedValue('reset')

    const result = await action({
      request: makeRequest({ intent: 'reset_history_marker', id: '12', confirmed: 'yes' }),
    } as never)

    expect(mockResetNaisHistorySyncMarker).toHaveBeenCalledWith(12)
    expect(mockInfo).toHaveBeenCalledWith('Admin requested a full Nais history replay', {
      monitoredAppId: 12,
      adminNavIdent: 'Z990001',
    })
    expect(result).toEqual({
      success: 'Historikkmarkøren er nullstilt. Den periodiske synkroniseringen vil hente hele historikken på nytt.',
    })
  })
})

describe('Nais history recovery loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({ navIdent: 'Z990001' })
    mockGetCompletedNaisSyncsInWindow.mockResolvedValue([])
  })

  function load(query: string) {
    return loader({
      request: new Request(`http://localhost/admin/nais-history-recovery${query}`),
    } as Parameters<typeof loader>[0])
  }

  it('queries completed syncs for a valid window', async () => {
    const result = await load('?from=2026-01-14T10:00:00%2B01:00&to=2026-01-14T16:00:00%2B01:00')

    expect(mockGetCompletedNaisSyncsInWindow).toHaveBeenCalledWith(
      new Date('2026-01-14T10:00:00+01:00'),
      new Date('2026-01-14T16:00:00+01:00'),
    )
    expect(result.windowSyncs).toEqual([])
    expect(result.windowError).toBeNull()
  })

  it('rejects a window without time zone or with reversed bounds', async () => {
    const noZone = await load('?from=2026-01-14T10:00:00&to=2026-01-14T16:00:00')
    const reversed = await load('?from=2026-01-14T16:00:00Z&to=2026-01-14T10:00:00Z')

    expect(noZone.windowError).not.toBeNull()
    expect(reversed.windowError).not.toBeNull()
    expect(mockGetCompletedNaisSyncsInWindow).not.toHaveBeenCalled()
  })

  it('skips the window query when no window is given', async () => {
    const result = await load('')

    expect(result.windowSyncs).toBeNull()
    expect(result.windowError).toBeNull()
  })
})
