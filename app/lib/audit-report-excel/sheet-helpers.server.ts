import type ExcelJS from 'exceljs'
import { ndaDeploymentUrl } from '~/lib/audit-report-texts'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1B3A56' },
}
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
const BORDER_THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFD0D0D0' } }
const CELL_BORDERS: Partial<ExcelJS.Borders> = {
  top: BORDER_THIN,
  left: BORDER_THIN,
  bottom: BORDER_THIN,
  right: BORDER_THIN,
}

export function addIntroRow(sheet: ExcelJS.Worksheet, text: string, columnCount: number) {
  const row = sheet.addRow([text])
  sheet.mergeCells(row.number, 1, row.number, columnCount)
  row.height = 30
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }
  row.getCell(1).font = { size: 9, color: { argb: 'FF333333' } }
  row.getCell(1).alignment = { wrapText: true, vertical: 'middle' }
}

export function addWarningNoteRow(sheet: ExcelJS.Worksheet, text: string, columnCount: number) {
  const row = sheet.addRow([text])
  sheet.mergeCells(row.number, 1, row.number, columnCount)
  row.height = 30
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } }
  row.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF664D03' } }
  row.getCell(1).alignment = { wrapText: true, vertical: 'middle' }
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const UNVERIFIED_REASON_LABELS: Record<string, string> = {
  no_pr: 'Ingen PR funnet',
  no_approved_reviews: 'Ingen godkjent review',
  approval_before_last_commit: 'Godkjenning før siste commit',
  self_approval: 'Selvgodkjenning',
  pr_not_approved: 'PR ikke godkjent',
}

export function formatUnverifiedReason(reason: string): string {
  return UNVERIFIED_REASON_LABELS[reason] || reason
}

export function applyHeaderRow(_sheet: ExcelJS.Worksheet, row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.border = CELL_BORDERS
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  row.height = 24
}

export function applyDataRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = CELL_BORDERS
    cell.alignment = { vertical: 'top', wrapText: true }
  })
}

export function setDeploymentIdLink(
  row: ExcelJS.Row,
  cell: number,
  deploymentId: number,
  teamSlug: string,
  environmentName: string,
  appName: string,
) {
  const url = ndaDeploymentUrl(teamSlug, environmentName, appName, deploymentId)
  row.getCell(cell).value = { text: String(deploymentId), hyperlink: url }
  row.getCell(cell).font = { color: { argb: 'FF005B82' }, underline: true }
}
