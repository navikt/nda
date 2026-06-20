import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

vi.mock('~/lib/gcs.server', () => ({
  isGcsConfigured: vi.fn(() => false),
  logExists: vi.fn(),
  downloadLog: vi.fn(),
  uploadLog: vi.fn(),
}))

vi.mock('~/lib/github', () => ({
  getGitHubClient: vi.fn(),
}))

vi.mock('~/lib/logger.server', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}))

import { isGcsConfigured } from '~/lib/gcs.server'
import { getGitHubClient } from '~/lib/github'
import { loader } from '../../routes/api/checks.logs'

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/checks/logs')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString())
}

function makeOctokitError(status: number, message: string) {
  const error = new Error(message)
  ;(error as Error & { status: number }).status = status
  error.name = 'HttpError'
  return error
}

describe('checks.logs loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isGcsConfigured).mockReturnValue(false)
  })

  it('returns 400 when required params are missing', async () => {
    const response = await loader({ request: makeRequest({}) } as never)
    expect(response.status).toBe(400)
  })

  it('returns cached logs from GCS when available', async () => {
    const { isGcsConfigured, logExists, downloadLog } = await import('~/lib/gcs.server')
    vi.mocked(isGcsConfigured).mockReturnValue(true)
    vi.mocked(logExists).mockResolvedValue(true)
    vi.mocked(downloadLog).mockResolvedValue('cached log content')

    const response = await loader({
      request: makeRequest({ owner: 'navikt', repo: 'pen', job_id: '123' }),
    } as never)
    const data = await response.json()
    expect(data.source).toBe('cached')
    expect(data.logs).toBe('cached log content')
  })

  describe('404 detection with Octokit HttpError', () => {
    let mockClient: { request: MockInstance; actions: { downloadJobLogsForWorkflowRun: MockInstance } }

    beforeEach(() => {
      mockClient = {
        request: vi.fn().mockResolvedValue({ headers: {} }),
        actions: { downloadJobLogsForWorkflowRun: vi.fn() },
      }
      vi.mocked(getGitHubClient).mockReturnValue(mockClient as never)
    })

    it('returns errorType "not_found" for Octokit 404 error (message: "Not Found")', async () => {
      mockClient.request.mockRejectedValue(
        makeOctokitError(404, 'Not Found - https://docs.github.com/rest/actions/workflow-jobs'),
      )

      const response = await loader({
        request: makeRequest({ owner: 'navikt', repo: 'pen', job_id: '123' }),
      } as never)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.errorType).toBe('not_found')
      expect(data.error).toBeDefined()
      expect(data.error).not.toBe('Kunne ikke hente logger.')
    })

    it('returns errorType "not_found" for Octokit 410 error', async () => {
      mockClient.request.mockRejectedValue(makeOctokitError(410, 'Gone'))

      const response = await loader({
        request: makeRequest({ owner: 'navikt', repo: 'pen', job_id: '456' }),
      } as never)

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.errorType).toBe('not_found')
    })

    it('returns errorType "server_error" for non-404 errors', async () => {
      mockClient.request.mockRejectedValue(makeOctokitError(500, 'Internal Server Error'))

      const response = await loader({
        request: makeRequest({ owner: 'navikt', repo: 'pen', job_id: '789' }),
      } as never)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.errorType).toBe('server_error')
    })

    it('returns errorType "server_error" for generic errors without status', async () => {
      mockClient.request.mockRejectedValue(new Error('Network timeout'))

      const response = await loader({
        request: makeRequest({ owner: 'navikt', repo: 'pen', job_id: '789' }),
      } as never)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.errorType).toBe('server_error')
    })

    it('fetches and returns logs from GitHub on success', async () => {
      mockClient.request.mockResolvedValue({ headers: { location: 'https://storage.example.com/logs' } })
      mockClient.actions.downloadJobLogsForWorkflowRun.mockResolvedValue({ data: 'log content from github' })

      const response = await loader({
        request: makeRequest({ owner: 'navikt', repo: 'pen', job_id: '123' }),
      } as never)

      const data = await response.json()
      expect(data.logs).toBe('log content from github')
      expect(data.source).toBe('github')
    })
  })
})
