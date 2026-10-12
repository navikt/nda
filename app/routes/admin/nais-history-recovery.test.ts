import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireAdmin, mockResetNaisHistorySyncMarker, mockGetNaisHistoryRiskApps } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetNaisHistoryRiskApps: vi.fn(),
  mockResetNaisHistorySyncMarker: vi.fn(),
}))
const mockInfo = vi.hoisted(() => vi.fn())

vi.mock('~/lib/auth.server', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('~/db/monitored-applications.server', () => ({
  getNaisHistoryRecoveryCandidates: vi.fn().mockResolvedValue([]),
  getNaisHistoryRiskApps: mockGetNaisHistoryRiskApps,
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
    mockGetNaisHistoryRiskApps.mockResolvedValue([])
  })

  it('returns risk apps covering all stored history', async () => {
    const result = await loader({
      request: new Request('http://localhost/admin/nais-history-recovery'),
    } as Parameters<typeof loader>[0])

    expect(mockGetNaisHistoryRiskApps).toHaveBeenCalledWith()
    expect(result.riskApps).toEqual([])
  })
})
