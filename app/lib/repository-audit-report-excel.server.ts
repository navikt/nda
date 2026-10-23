import ExcelJS from 'exceljs'
import { addIntroRow, applyDataRow, applyHeaderRow } from './audit-report-excel/sheet-helpers.server'
import {
  buildRepositoryReportSections,
  buildRepositoryReportSummary,
  isHttpUrl,
  REPOSITORY_REPORT_INTRO,
  REPOSITORY_REPORT_SECTION_INTRODUCTIONS,
  type RepositoryReportOutputProps,
  type RepositoryReportSummary,
} from './repository-audit-report-output'

function addSummarySheet(workbook: ExcelJS.Workbook, summary: RepositoryReportSummary) {
  const sheet = workbook.addWorksheet('Sammendrag')
  sheet.columns = [{ width: 34 }, { width: 84 }]
  const title = sheet.addRow(['RAPPORT OM ETTERLEVELSE — Leveranser'])
  title.font = { bold: true, size: 16, color: { argb: 'FF005B82' } }
  sheet.mergeCells(title.number, 1, title.number, 2)
  addIntroRow(sheet, REPOSITORY_REPORT_INTRO, 2)
  for (const [label, value] of summary.metadata) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true }
    applyDataRow(row)
  }
  sheet.addRow([])
  const summaryTitle = sheet.addRow(['Sammendrag'])
  summaryTitle.font = { bold: true, size: 14, color: { argb: 'FF005B82' } }
  sheet.mergeCells(summaryTitle.number, 1, summaryTitle.number, 2)
  const header = sheet.addRow(['Felt', 'Verdi'])
  applyHeaderRow(sheet, header)
  for (const [label, value] of [...summary.values, ...summary.context]) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true }
    applyDataRow(row)
  }
}

export async function generateRepositoryAuditReportExcel(props: RepositoryReportOutputProps): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Deployment Audit System'
  workbook.created = props.generatedAt
  const summary = buildRepositoryReportSummary(props)
  addSummarySheet(workbook, summary)
  for (const section of buildRepositoryReportSections(props, summary).filter((item) => item.title !== 'Sammendrag')) {
    const sheet = workbook.addWorksheet(section.title)
    sheet.columns = section.headers.map((header) => ({ width: Math.max(18, Math.min(40, header.length + 8)) }))
    addIntroRow(
      sheet,
      REPOSITORY_REPORT_SECTION_INTRODUCTIONS[section.title] ?? 'Evidens i repositorybasert rapportgrunnlag.',
      section.headers.length,
    )
    const headerRow = sheet.addRow(section.headers)
    applyHeaderRow(sheet, headerRow)
    for (const [rowIndex, values] of section.rows.entries()) {
      const row = sheet.addRow(values)
      applyDataRow(row)
      for (const [columnIndex, url] of Object.entries(section.cellLinks?.[rowIndex] ?? {})) {
        if (!isHttpUrl(url)) continue
        const cell = row.getCell(Number(columnIndex) + 1)
        cell.value = { text: values[Number(columnIndex)] ?? '', hyperlink: url }
        cell.font = { color: { argb: 'FF005B82' }, underline: true }
      }
    }
    sheet.autoFilter = { from: 'A2', to: `${String.fromCharCode(64 + section.headers.length)}2` }
    sheet.views = [{ state: 'frozen', ySplit: 2 }]
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
