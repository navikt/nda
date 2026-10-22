import { RouterContextProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  findJob: vi.fn(),
  process: vi.fn(),
  hasReport: vi.fn(),
}))

vi.mock('~/db/report-jobs.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/db/report-jobs.server')>()),
  createReportJob: mocks.createJob,
  findInFlightJob: mocks.findJob,
}))
vi.mock('~/db/audit-reports.server', () => ({
  hasActiveReportForPeriod: mocks.hasReport,
  getReportSummaryById: vi.fn(),
}))
vi.mock('~/db/monitored-applications.server', () => ({
  getMonitoredApplicationByIdentity: vi.fn().mockResolvedValue({ id: 1 }),
}))
vi.mock('~/db/repositories.server', () => ({ getEffectiveAuditStartYear: vi.fn().mockResolvedValue(null) }))
vi.mock('~/lib/api/app-metadata.server', () => ({ buildAppMetadata: vi.fn().mockResolvedValue({ name: 'test' }) }))
vi.mock('~/lib/m2m-auth.server', () => ({ requireM2MToken: vi.fn().mockResolvedValue({ azp: 'test-client' }) }))
vi.mock('~/lib/report-job-processor.server', () => ({ processReportJobAsync: mocks.process }))
vi.mock('~/lib/logger.server', () => ({ logger: { error: vi.fn() } }))

import { ReportJobModelConflictError } from '~/db/report-jobs.server'
import { action } from '~/routes/api/v1.apps.$team.$env.$app.audit-reports.generate'

function generate() {
  const request = new Request('http://localhost/api/v1/apps/team-fjord/prod-gcp/test/audit-reports/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ periodType: 'yearly', periodStart: '2025-01-01' }),
  })
  return action({
    request,
    params: { team: 'team-fjord', env: 'prod-gcp', app: 'test' },
    context: new RouterContextProvider(),
    url: new URL(request.url),
    pattern: '/api/v1/apps/:team/:env/:app/audit-reports/generate',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findJob.mockResolvedValue(null)
  mocks.hasReport.mockResolvedValue(false)
  mocks.process.mockResolvedValue(undefined)
})

describe('M2M report generation model conflicts', () => {
  it('returns the standard JSON 409 instead of a 500 for a cross-model job conflict', async () => {
    mocks.createJob.mockRejectedValue(new ReportJobModelConflictError())
    const response = await generate().catch((error: unknown) => {
      if (!(error instanceof Response)) throw error
      return error
    })
    expect(response.status).toBe(409)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    expect(await response.json()).toEqual({ error: expect.stringContaining('another assessment model') })
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('does not turn unrelated database failures into model conflicts', async () => {
    const error = new Error('Database unavailable')
    mocks.createJob.mockRejectedValue(error)
    await expect(generate()).rejects.toBe(error)
    expect(mocks.process).not.toHaveBeenCalled()
  })

  it('starts an application job normally after stale-job cleanup succeeds', async () => {
    mocks.createJob.mockResolvedValue({ jobId: 'job-1', created: true, status: 'pending' })
    const response = await generate()
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ jobId: 'job-1', status: 'pending' })
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', appId: 1 }))
  })
})
