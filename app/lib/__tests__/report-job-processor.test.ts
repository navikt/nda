import { beforeEach, describe, expect, it, vi } from 'vitest'
import { repositoryReportFixture } from './fixtures/repository-audit-report'

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  readRepository: vi.fn(),
  readApplication: vi.fn(),
  buildApplication: vi.fn(),
  save: vi.fn(),
  saveFile: vi.fn(),
  archive: vi.fn(),
  setReport: vi.fn(),
  update: vi.fn(),
  repositoryPdf: vi.fn(),
  repositoryExcel: vi.fn(),
  applicationPdf: vi.fn(),
  applicationExcel: vi.fn(),
}))

vi.mock('~/db/audit-reports.server', () => ({
  getAuditReportData: mocks.readApplication,
  buildReportData: mocks.buildApplication,
  saveAuditReport: mocks.save,
  saveAuditReportFile: mocks.saveFile,
  archiveAuditReport: mocks.archive,
}))
vi.mock('~/db/audit-reports/repository-data.server', () => ({ getRepositoryAuditReportData: mocks.readRepository }))
vi.mock('~/db/report-jobs.server', () => ({
  claimReportJob: mocks.claim,
  setReportJobAuditReportId: mocks.setReport,
  updateReportJobStatus: mocks.update,
}))
vi.mock('~/lib/audit-report-pdf', () => ({ generateAuditReportPdf: mocks.applicationPdf }))
vi.mock('~/lib/audit-report-excel.server', () => ({ generateAuditReportExcel: mocks.applicationExcel }))
vi.mock('~/lib/repository-audit-report-pdf', () => ({ generateRepositoryAuditReportPdf: mocks.repositoryPdf }))
vi.mock('~/lib/repository-audit-report-excel.server', () => ({
  generateRepositoryAuditReportExcel: mocks.repositoryExcel,
}))
vi.mock('~/lib/logger.server', () => ({ logger: { error: vi.fn() } }))

import { processReportJobAsync } from '../report-job-processor.server'

const params = {
  jobId: 'job-1',
  appId: 1,
  year: 2026,
  periodType: 'monthly' as const,
  periodLabel: 'Januar 2026',
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-01-31'),
}

beforeEach(() => {
  vi.resetAllMocks()
  const props = repositoryReportFixture()
  mocks.claim.mockResolvedValue(true)
  mocks.readRepository.mockResolvedValue({ reportData: props.reportData, readiness: { isReady: true } })
  mocks.readApplication.mockResolvedValue({
    app: {
      app_name: props.appName,
      team_slug: props.teamSlug,
      environment_name: props.environmentName,
      test_requirement: 'none',
    },
    repository: 'navikt/test',
  })
  mocks.buildApplication.mockReturnValue({ deployments: [] })
  mocks.save.mockResolvedValue({
    id: 10,
    app_name: props.appName,
    team_slug: props.teamSlug,
    environment_name: props.environmentName,
    period_start: props.periodStart,
    period_end: props.periodEnd,
    generated_at: props.generatedAt,
    content_hash: props.contentHash,
    report_id: props.reportId,
  })
  for (const generator of [mocks.repositoryPdf, mocks.repositoryExcel, mocks.applicationPdf, mocks.applicationExcel]) {
    generator.mockResolvedValue(Buffer.from('export'))
  }
})

describe('report jobs', () => {
  it('uses the same generation snapshot for persistence and both repository exports', async () => {
    await processReportJobAsync({ ...params, assessmentModel: 'repository' })
    expect(mocks.claim).toHaveBeenCalledWith('job-1', 'repository')
    expect(mocks.readRepository).toHaveBeenCalledTimes(1)
    expect(mocks.readApplication).not.toHaveBeenCalled()
    const savedData = mocks.save.mock.calls[0][0].reportData
    expect(mocks.repositoryPdf.mock.calls[0][0].reportData).toBe(savedData)
    expect(mocks.repositoryExcel.mock.calls[0][0].reportData).toBe(savedData)
    expect(mocks.saveFile).toHaveBeenCalledWith(10, 'pdf', expect.any(Buffer))
    expect(mocks.saveFile).toHaveBeenCalledWith(10, 'xlsx', expect.any(Buffer))
    expect(mocks.update).toHaveBeenCalledWith('job-1', 'completed', expect.any(Buffer))
  })

  it('fails before persistence if repository readiness changed after the UI check', async () => {
    mocks.readRepository.mockResolvedValue({ readiness: { isReady: false } })
    await expect(processReportJobAsync({ ...params, assessmentModel: 'repository' })).rejects.toThrow('not ready')
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.repositoryPdf).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith('job-1', 'failed', undefined, expect.stringContaining('not ready'))
  })

  it('leaves the default job on the application pipeline', async () => {
    await processReportJobAsync(params)
    expect(mocks.claim).toHaveBeenCalledWith('job-1', 'application')
    expect(mocks.applicationPdf).toHaveBeenCalled()
    expect(mocks.applicationExcel).toHaveBeenCalled()
    expect(mocks.readRepository).not.toHaveBeenCalled()
  })

  it('archives a failed repository export instead of leaving an active report without a PDF', async () => {
    mocks.repositoryPdf.mockRejectedValue(new Error('PDF failed'))
    await expect(processReportJobAsync({ ...params, assessmentModel: 'repository' })).rejects.toThrow('PDF failed')
    expect(mocks.archive).toHaveBeenCalledWith(10, 1, 'system', 'Report generation failed')
    expect(mocks.update).toHaveBeenCalledWith('job-1', 'failed', undefined, 'PDF failed')
  })
})
