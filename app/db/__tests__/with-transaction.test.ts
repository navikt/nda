import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConnect = vi.fn()

vi.mock('pg', () => ({
  Pool: class {
    connect = mockConnect
    on = vi.fn()
    query = vi.fn()
  },
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

vi.mock('~/lib/tracing.server', () => ({
  withDbSpan: async (_operation: string, _sql: string, fn: () => Promise<unknown>) => fn(),
}))

describe('withTransaction', () => {
  beforeEach(() => {
    vi.resetModules()
    mockConnect.mockReset()
    process.env.DATABASE_URL = 'postgres://localhost/test'
  })

  it('commits the transaction and returns the callback result when it succeeds', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }
    mockConnect.mockResolvedValue(client)

    const { withTransaction } = await import('../connection.server')
    const result = await withTransaction(async () => 'ok')

    expect(result).toBe('ok')
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT')
    expect(client.query).not.toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back and re-throws when the callback fails after a successful query inside the transaction', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }
    mockConnect.mockResolvedValue(client)

    const { withTransaction } = await import('../connection.server')

    const callbackError = new Error('audit log insert failed')
    await expect(
      withTransaction(async (txClient) => {
        await txClient.query('UPDATE monitored_applications SET slack_notifications_enabled = true WHERE id = 1')
        throw callbackError
      }),
    ).rejects.toThrow(callbackError)

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'UPDATE monitored_applications SET slack_notifications_enabled = true WHERE id = 1',
    )
    expect(client.query).toHaveBeenNthCalledWith(3, 'ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('logs but does not swallow the original error when the rollback itself fails', async () => {
    const rollbackError = new Error('connection lost')
    const client = {
      query: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve({ rows: [] })) // BEGIN
        .mockImplementationOnce(() => Promise.reject(rollbackError)), // ROLLBACK
      release: vi.fn(),
    }
    mockConnect.mockResolvedValue(client)

    const { withTransaction } = await import('../connection.server')
    const { logger } = await import('~/lib/logger.server')

    const callbackError = new Error('something failed')
    await expect(
      withTransaction(async () => {
        throw callbackError
      }),
    ).rejects.toThrow(callbackError)

    expect(logger.error).toHaveBeenCalledWith('Failed to roll back transaction', rollbackError)
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
