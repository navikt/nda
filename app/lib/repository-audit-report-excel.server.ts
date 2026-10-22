import ExcelJS from 'exceljs'
import { applyDataRow, applyHeaderRow } from './audit-report-excel/sheet-helpers.server'
import { buildRepositoryReportSections, type RepositoryReportOutputProps } from './repository-audit-report-output'

export async function generateRepositoryAuditReportExcel(props: RepositoryReportOutputProps): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  for (const section of buildRepositoryReportSections(props)) {
    const sheet = workbook.addWorksheet(section.title)
    sheet.columns = section.headers.map((header) => ({ header, width: 45 }))
    applyHeaderRow(sheet, sheet.getRow(1))
    for (const values of section.rows) {
      const row = sheet.addRow(values)
      applyDataRow(row)
      row.alignment = { vertical: 'top', wrapText: true }
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
