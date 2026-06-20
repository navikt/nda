import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getActiveReportsForAppM2M,
  getAuditReportFile,
  getAuditReportsForApp,
  saveAuditReport,
  saveAuditReportFile,
} from '../../audit-reports.server'
import { seedApp, truncateAllTables } from './helpers'

let pool: Pool

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL })
})

afterAll(async () => {
  await pool.end()
})

afterEach(async () => {
  await truncateAllTables(pool)
})

const minimalReportData = {
  deployments: [],
  manual_approvals: [],
  contributors: [],
  reviewers: [],
  legacy_count: 0,
  deviations: [],
  unverified_commit_deployments: [],
}

async function seedReport(appId: number) {
  return saveAuditReport({
    monitoredAppId: appId,
    appName: 'test-app',
    teamSlug: 'team-a',
    environmentName: 'prod-fss',
    repository: 'navikt/test-app',
    year: 2025,
    periodType: 'yearly',
    periodLabel: 'Årsrapport 2025',
    periodStart: new Date('2025-01-01'),
    periodEnd: new Date('2025-12-31'),
    reportData: minimalReportData,
    generatedBy: 'Z990001',
  })
}

describe('saveAuditReportFile', () => {
  it('stores a pdf file and retrieves it', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-a', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)

    const pdfData = Buffer.from('fake-pdf-content')
    await saveAuditReportFile(report.id, 'pdf', pdfData)

    const retrieved = await getAuditReportFile(report.id, 'pdf')
    expect(retrieved).not.toBeNull()
    expect(Buffer.from(retrieved ?? Buffer.alloc(0)).toString()).toBe('fake-pdf-content')
  })

  it('upserts — overwrites existing file on conflict', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-b', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)

    await saveAuditReportFile(report.id, 'pdf', Buffer.from('v1'))
    await saveAuditReportFile(report.id, 'pdf', Buffer.from('v2'))

    const retrieved = await getAuditReportFile(report.id, 'pdf')
    expect(Buffer.from(retrieved ?? Buffer.alloc(0)).toString()).toBe('v2')
  })

  it('stores pdf and xlsx independently under the same report', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-c', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)

    await saveAuditReportFile(report.id, 'pdf', Buffer.from('pdf-bytes'))
    await saveAuditReportFile(report.id, 'xlsx', Buffer.from('xlsx-bytes'))

    const pdfResult = await getAuditReportFile(report.id, 'pdf')
    const xlsxResult = await getAuditReportFile(report.id, 'xlsx')
    expect(Buffer.from(pdfResult ?? Buffer.alloc(0)).toString()).toBe('pdf-bytes')
    expect(Buffer.from(xlsxResult ?? Buffer.alloc(0)).toString()).toBe('xlsx-bytes')
  })
})

describe('getAuditReportFile', () => {
  it('returns null when no file exists for the given format', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-d', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)

    expect(await getAuditReportFile(report.id, 'pdf')).toBeNull()
  })

  it('returns null for a different format when only one format is stored', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-e', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)

    await saveAuditReportFile(report.id, 'xlsx', Buffer.from('xlsx-only'))

    expect(await getAuditReportFile(report.id, 'pdf')).toBeNull()
  })
})

describe('formats subquery in getAuditReportsForApp', () => {
  it('returns empty formats array when no files are stored', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-h', appName: 'test-app', environment: 'prod-fss' })
    await seedReport(appId)

    const reports = await getAuditReportsForApp(appId)
    expect(reports).toHaveLength(1)
    expect(reports[0].formats).toEqual([])
  })

  it('returns ["pdf"] when only pdf is stored', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-i', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)
    await saveAuditReportFile(report.id, 'pdf', Buffer.from('pdf'))

    const reports = await getAuditReportsForApp(appId)
    expect(reports[0].formats).toEqual(['pdf'])
  })

  it('returns ["pdf","xlsx"] when both files are stored', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-j', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)
    await saveAuditReportFile(report.id, 'pdf', Buffer.from('pdf'))
    await saveAuditReportFile(report.id, 'xlsx', Buffer.from('xlsx'))

    const reports = await getAuditReportsForApp(appId)
    expect(reports[0].formats).toEqual(['pdf', 'xlsx'])
  })
})

describe('getActiveReportsForAppM2M — has-pdf filter', () => {
  it('excludes reports without a pdf file', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-f', appName: 'test-app', environment: 'prod-fss' })
    await seedReport(appId)

    const reports = await getActiveReportsForAppM2M(appId)
    expect(reports).toHaveLength(0)
  })

  it('includes reports that have a pdf file', async () => {
    const appId = await seedApp(pool, { teamSlug: 'team-g', appName: 'test-app', environment: 'prod-fss' })
    const report = await seedReport(appId)
    await saveAuditReportFile(report.id, 'pdf', Buffer.from('pdf'))

    const reports = await getActiveReportsForAppM2M(appId)
    expect(reports).toHaveLength(1)
    expect(reports[0].id).toBe(report.id)
  })
})
