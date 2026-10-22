import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { generateRepositoryAuditReportExcel } from '../repository-audit-report-excel.server'
import { buildRepositoryReportSections } from '../repository-audit-report-output'
import { generateRepositoryAuditReportPdf } from '../repository-audit-report-pdf'
import { repositoryReportFixture } from './fixtures/repository-audit-report'

describe('repository report exports', () => {
  it('keeps deployment rows separate from shared code evidence and preserves after-control dates', () => {
    const props = repositoryReportFixture()
    const sections = buildRepositoryReportSections(props)
    expect(sections.find((section) => section.title === 'Deployments')?.rows).toHaveLength(2)
    expect(sections.find((section) => section.title === 'Commits')?.rows).toHaveLength(1)
    const history = sections.find((section) => section.title === 'Manuell historikk')
    expect(history?.rows[0]).toContain('2026-01-20T00:00:00Z\n2026-01-21T00:00:00Z')
    expect(JSON.stringify(sections)).toContain('inkludert etterkontroll')
    expect(JSON.stringify(sections)).toContain(props.reportData.deliveries[0].baseSha)
    expect(JSON.stringify(sections)).toContain('50')
  })

  it('produces a readable workbook with frozen evidence and no legacy deployment-method counts', async () => {
    const workbook = new ExcelJS.Workbook()
    const bytes = await generateRepositoryAuditReportExcel(repositoryReportFixture())
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer)
    expect(workbook.getWorksheet('Deployments')?.rowCount).toBe(3)
    expect(workbook.getWorksheet('Commits')?.rowCount).toBe(2)
    expect(workbook.getWorksheet('Manuell historikk')?.getRow(2).values).toContain(
      '2026-01-20T00:00:00Z\n2026-01-21T00:00:00Z',
    )
    expect(JSON.stringify(workbook.getWorksheet('Sammendrag')?.getSheetValues())).not.toContain('Via Pull Request')
  })

  it('renders a PDF without fetching current evidence or remote fonts', async () => {
    const pdf = await generateRepositoryAuditReportPdf(repositoryReportFixture())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1000)
  })

  it('supports an explicitly empty period', async () => {
    const props = repositoryReportFixture()
    props.reportData.deployments = []
    props.reportData.deliveries = []
    expect(JSON.stringify(buildRepositoryReportSections(props))).toContain('Ingen deployments registrert')
    expect(await generateRepositoryAuditReportExcel(props)).toBeInstanceOf(Buffer)
  })

  it('rejects exports if any deployment no longer satisfies readiness', async () => {
    const props = repositoryReportFixture()
    props.reportData.deployments[0].source.repositoryAuthorization = null
    await expect(generateRepositoryAuditReportExcel(props)).rejects.toThrow('not ready')
    await expect(generateRepositoryAuditReportPdf(props)).rejects.toThrow('not ready')
  })
})
