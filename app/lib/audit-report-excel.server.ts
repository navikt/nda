import ExcelJS from 'exceljs'
import type {
  AuditDeploymentEntry,
  AuditReportData,
  DeviationEntry,
  ManualApprovalEntry,
  UnverifiedCommitDeploymentEntry,
} from '~/db/audit-reports.server'
import {
  DEVIATIONS_INTRO,
  MANUAL_APPROVALS_INTRO,
  UNVERIFIED_COMMITS_INTRO,
  UNVERIFIED_COMMITS_NOTE,
} from '~/lib/audit-report-texts'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
  type DeviationFollowUpRole,
  type DeviationIntent,
  type DeviationSeverity,
} from '~/lib/deviation-constants'
import { formatPercentages } from '~/lib/format-percentages'

interface AuditReportExcelProps {
  appName: string
  repository: string
  teamSlug: string
  environmentName: string
  year: number
  periodLabel?: string
  periodStart: Date
  periodEnd: Date
  reportData: AuditReportData
  contentHash: string
  reportId: string
  generatedAt: Date
}

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

function addIntroRow(sheet: ExcelJS.Worksheet, text: string, columnCount: number) {
  const row = sheet.addRow([text])
  sheet.mergeCells(row.number, 1, row.number, columnCount)
  row.height = 30
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }
  row.getCell(1).font = { size: 9, color: { argb: 'FF333333' } }
  row.getCell(1).alignment = { wrapText: true, vertical: 'middle' }
}

function addWarningNoteRow(sheet: ExcelJS.Worksheet, text: string, columnCount: number) {
  const row = sheet.addRow([text])
  sheet.mergeCells(row.number, 1, row.number, columnCount)
  row.height = 30
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } }
  row.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF664D03' } }
  row.getCell(1).alignment = { wrapText: true, vertical: 'middle' }
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`
}

function formatDateTime(date: Date | string): string {
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
  pr_not_approved: 'PR ikke godkjent',
}

function formatUnverifiedReason(reason: string): string {
  return UNVERIFIED_REASON_LABELS[reason] || reason
}

function applyHeaderRow(_sheet: ExcelJS.Worksheet, row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.border = CELL_BORDERS
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  row.height = 24
}

function applyDataRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = CELL_BORDERS
    cell.alignment = { vertical: 'top', wrapText: true }
  })
}

function methodLabel(method: string): string {
  if (method === 'pr') return 'PR'
  if (method === 'legacy') return 'Legacy'
  if (method === 'baseline') return 'Baseline'
  return 'Manuell'
}

function addSammendragSheet(workbook: ExcelJS.Workbook, props: AuditReportExcelProps) {
  const {
    appName,
    repository,
    teamSlug,
    environmentName,
    periodLabel,
    periodStart,
    periodEnd,
    reportData,
    contentHash,
    reportId,
    generatedAt,
  } = props
  const sheet = workbook.addWorksheet('Sammendrag')
  sheet.columns = [{ width: 30 }, { width: 60 }]

  const titleRow = sheet.addRow(['RAPPORT OM ETTERLEVELSE — Leveranser'])
  titleRow.font = { bold: true, size: 16 }
  sheet.mergeCells(titleRow.number, 1, titleRow.number, 2)
  sheet.addRow([])

  const infoRows: [string, string][] = [
    ['Applikasjon', appName],
    ['Repository', repository],
    ['Team', teamSlug],
    ['Miljø', environmentName],
    ['Periode', `${periodLabel ? `${periodLabel} — ` : ''}${formatDate(periodStart)} - ${formatDate(periodEnd)}`],
    ['Dokument-ID', reportId],
    ['Generert', formatDateTime(generatedAt)],
    ['SHA256', contentHash],
  ]

  for (const [label, value] of infoRows) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true }
  }

  sheet.addRow([])
  const summaryTitle = sheet.addRow(['Sammendrag'])
  summaryTitle.font = { bold: true, size: 14 }
  sheet.mergeCells(summaryTitle.number, 1, summaryTitle.number, 2)

  const totalDeployments = reportData.deployments.length
  const prApprovedCount = reportData.deployments.filter((d) => d.method === 'pr').length
  const manuallyApprovedCount = reportData.deployments.filter((d) => d.method === 'manual').length
  const baselineCount = reportData.deployments.filter((d) => d.method === 'baseline').length
  const legacyCount = reportData.legacy_count || 0
  const [prDisplay, manualDisplay, baselineDisplay, legacyDisplay] = formatPercentages(
    [prApprovedCount, manuallyApprovedCount, baselineCount, legacyCount],
    totalDeployments,
  )

  const summaryRows: [string, string][] = [
    ['Status', '✓ GODKJENT'],
    ['Totalt antall deployments', String(totalDeployments)],
    ['Via Pull Request', `${prApprovedCount} (${prDisplay}%)`],
    ['Manuelt godkjent', `${manuallyApprovedCount} (${manualDisplay}%)`],
  ]
  if (baselineCount > 0) {
    summaryRows.push(['Baseline', `${baselineCount} (${baselineDisplay}%)`])
  }
  if (legacyCount > 0) {
    summaryRows.push(['Legacy', `${legacyCount} (${legacyDisplay}%)`])
  }
  summaryRows.push(
    ['Unike bidragsytere', `${reportData.contributors.length} personer`],
    ['Unike reviewers', `${reportData.reviewers.length} personer`],
  )

  for (const [label, value] of summaryRows) {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true }
  }
}

function addDeploymentsSheet(workbook: ExcelJS.Workbook, deployments: AuditDeploymentEntry[], repository: string) {
  const sheet = workbook.addWorksheet('Deployments')
  sheet.columns = [
    { header: '#', width: 6 },
    { header: 'Deployment ID', width: 14 },
    { header: 'Tidspunkt', width: 18 },
    { header: 'Tittel', width: 30 },
    { header: 'Commit', width: 12 },
    { header: 'Metode', width: 10 },
    { header: 'Referanse', width: 14 },
    { header: 'PR-forfatter', width: 18 },
    { header: 'Deployer', width: 18 },
    { header: 'Godkjenner', width: 18 },
    { header: 'Nais ID', width: 20 },
    { header: 'Endringsopphav', width: 40 },
  ]

  applyHeaderRow(sheet, sheet.getRow(1))

  deployments.forEach((d, idx) => {
    const commitShort = d.commit_sha && !d.commit_sha.startsWith('refs/') ? d.commit_sha.substring(0, 7) : '-'
    const commitUrl =
      d.commit_sha && !d.commit_sha.startsWith('refs/')
        ? `https://github.com/${repository}/commit/${d.commit_sha}`
        : undefined

    let reference = '-'
    if (d.method !== 'legacy') {
      if (d.pr_number) {
        reference = `PR #${d.pr_number}`
      } else if (d.slack_link) {
        reference = 'Slack'
      }
    }

    const goalLinks =
      d.goal_links
        ?.map(
          (link) =>
            `${link.team_name} ${link.period_label} — ${link.objective_title}${link.key_result_title ? ` → ${link.key_result_title}` : ''}`,
        )
        .join('; ') || ''

    const row = sheet.addRow([
      idx + 1,
      d.id,
      formatDateTime(d.date),
      d.title || '-',
      commitShort,
      methodLabel(d.method),
      reference,
      d.pr_author_display_name || d.pr_author || '-',
      d.deployer_display_name || d.deployer,
      d.approver ? d.approver_display_name || d.approver : '-',
      d.nais_deployment_id || '',
      goalLinks,
    ])
    applyDataRow(row)

    if (commitUrl) {
      row.getCell(5).value = { text: commitShort, hyperlink: commitUrl }
      row.getCell(5).font = { color: { argb: 'FF005B82' }, underline: true }
    }

    if (d.pr_number && d.pr_url) {
      row.getCell(7).value = { text: `PR #${d.pr_number}`, hyperlink: d.pr_url }
      row.getCell(7).font = { color: { argb: 'FF005B82' }, underline: true }
    } else if (d.pr_number) {
      const prUrl = `https://github.com/${repository}/pull/${d.pr_number}`
      row.getCell(7).value = { text: `PR #${d.pr_number}`, hyperlink: prUrl }
      row.getCell(7).font = { color: { argb: 'FF005B82' }, underline: true }
    } else if (d.slack_link) {
      row.getCell(7).value = { text: 'Slack', hyperlink: d.slack_link }
      row.getCell(7).font = { color: { argb: 'FF005B82' }, underline: true }
    }
  })

  sheet.autoFilter = { from: 'A1', to: 'L1' }
}

function addManualApprovalsSheet(workbook: ExcelJS.Workbook, approvals: ManualApprovalEntry[], repository: string) {
  if (approvals.length === 0) return
  const sheet = workbook.addWorksheet('Manuelle godkjenninger')
  sheet.columns = [
    { width: 6 },
    { width: 14 },
    { width: 18 },
    { width: 30 },
    { width: 12 },
    { width: 18 },
    { width: 30 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 30 },
    { width: 40 },
  ]

  addIntroRow(sheet, MANUAL_APPROVALS_INTRO, 12)

  const headerRow = sheet.addRow([
    '#',
    'Deployment ID',
    'Tidspunkt',
    'Tittel',
    'Commit',
    'Deployer',
    'Årsak',
    'Registrert av',
    'Godkjent av',
    'Godkjent',
    'Slack',
    'Kommentar',
  ])
  applyHeaderRow(sheet, headerRow)

  approvals.forEach((a, idx) => {
    const commitShort = a.commit_sha ? a.commit_sha.substring(0, 7) : 'N/A'
    const commitUrl = a.commit_sha ? `https://github.com/${repository}/commit/${a.commit_sha}` : undefined

    const row = sheet.addRow([
      idx + 1,
      a.deployment_id,
      formatDateTime(a.date),
      a.title || '-',
      commitShort,
      a.deployer_display_name || a.deployer,
      a.reason,
      a.registered_by_display_name || a.registered_by,
      a.approved_by_display_name || a.approved_by,
      formatDateTime(a.approved_at),
      a.slack_link || '-',
      a.comment,
    ])
    applyDataRow(row)

    if (commitUrl) {
      row.getCell(5).value = { text: commitShort, hyperlink: commitUrl }
      row.getCell(5).font = { color: { argb: 'FF005B82' }, underline: true }
    }
    if (a.slack_link) {
      row.getCell(11).value = { text: a.slack_link, hyperlink: a.slack_link }
      row.getCell(11).font = { color: { argb: 'FF005B82' }, underline: true }
    }
  })

  sheet.autoFilter = { from: 'A2', to: 'L2' }
}

function addDeviationsSheet(workbook: ExcelJS.Workbook, deviations: DeviationEntry[], repository: string) {
  if (deviations.length === 0) return
  const sheet = workbook.addWorksheet('Avvik')
  sheet.columns = [
    { width: 6 },
    { width: 14 },
    { width: 18 },
    { width: 12 },
    { width: 40 },
    { width: 20 },
    { width: 18 },
    { width: 16 },
    { width: 20 },
    { width: 18 },
    { width: 24 },
    { width: 40 },
  ]

  addIntroRow(sheet, DEVIATIONS_INTRO, 12)

  const headerRow = sheet.addRow([
    '#',
    'Deployment ID',
    'Tidspunkt',
    'Commit',
    'Beskrivelse',
    'Type brudd',
    'Intensjon',
    'Alvorlighetsgrad',
    'Oppfølgingsansvarlig',
    'Registrert av',
    'Status',
    'Løsning',
  ])
  applyHeaderRow(sheet, headerRow)

  deviations.forEach((d, idx) => {
    const commitShort = d.commit_sha ? d.commit_sha.substring(0, 7) : 'N/A'
    const commitUrl = d.commit_sha ? `https://github.com/${repository}/commit/${d.commit_sha}` : undefined

    const status = d.resolved_at ? `Løst ${formatDateTime(d.resolved_at)}` : 'Åpen'

    const row = sheet.addRow([
      idx + 1,
      d.deployment_id,
      formatDateTime(d.date),
      commitShort,
      d.reason,
      d.breach_type || '-',
      d.intent ? DEVIATION_INTENT_LABELS[d.intent as DeviationIntent] || d.intent : '-',
      d.severity ? DEVIATION_SEVERITY_LABELS[d.severity as DeviationSeverity] || d.severity : '-',
      d.follow_up_role
        ? DEVIATION_FOLLOW_UP_ROLE_LABELS[d.follow_up_role as DeviationFollowUpRole] || d.follow_up_role
        : '-',
      d.registered_by_name || d.registered_by,
      status,
      d.resolution_note || '-',
    ])
    applyDataRow(row)

    if (commitUrl) {
      row.getCell(4).value = { text: commitShort, hyperlink: commitUrl }
      row.getCell(4).font = { color: { argb: 'FF005B82' }, underline: true }
    }
  })

  sheet.autoFilter = { from: 'A2', to: 'L2' }
}

function addUnverifiedCommitsSheet(
  workbook: ExcelJS.Workbook,
  entries: UnverifiedCommitDeploymentEntry[],
  _repository: string,
) {
  if (entries.length === 0) return
  const sheet = workbook.addWorksheet('Ikke-verifiserte commits')
  sheet.columns = [
    { width: 6 },
    { width: 14 },
    { width: 18 },
    { width: 30 },
    { width: 18 },
    { width: 30 },
    { width: 12 },
    { width: 50 },
    { width: 16 },
    { width: 24 },
    { width: 10 },
  ]

  addIntroRow(sheet, UNVERIFIED_COMMITS_INTRO, 11)
  addWarningNoteRow(sheet, UNVERIFIED_COMMITS_NOTE, 11)

  const headerRow = sheet.addRow([
    '#',
    'Deployment ID',
    'Tidspunkt',
    'Tittel',
    'Deployer',
    'Status',
    'Commit SHA',
    'Commit-melding',
    'Forfatter',
    'Årsak',
    'PR',
  ])
  applyHeaderRow(sheet, headerRow)

  entries.forEach((entry, entryIdx) => {
    const isApproved = entry.four_eyes_status === 'manually_approved'
    const statusText = isApproved
      ? `✓ Godkjent av: ${entry.approved_by_display_name || entry.approved_by}${entry.approved_at ? ` (${formatDateTime(entry.approved_at)})` : ''}`
      : '✗ Ikke godkjent etter fire-øyne-prinsippet'

    for (const commit of entry.commits) {
      const commitShort = commit.sha.substring(0, 7)

      const row = sheet.addRow([
        entryIdx + 1,
        entry.deployment_id,
        formatDateTime(entry.date),
        entry.title || '-',
        entry.deployer_display_name || entry.deployer,
        statusText,
        commitShort,
        commit.message.length > 120 ? `${commit.message.substring(0, 120)}…` : commit.message,
        commit.author,
        formatUnverifiedReason(commit.reason),
        commit.pr_number ? `#${commit.pr_number}` : '-',
      ])
      applyDataRow(row)

      row.getCell(7).value = { text: commitShort, hyperlink: commit.html_url }
      row.getCell(7).font = { color: { argb: 'FF005B82' }, underline: true }

      if (isApproved) {
        row.getCell(6).font = { color: { argb: 'FF006A2E' }, bold: true }
      } else {
        row.getCell(6).font = { color: { argb: 'FFBA3A26' }, bold: true }
      }
    }
  })

  sheet.autoFilter = { from: 'A3', to: 'K3' }
}

export async function generateAuditReportExcel(props: AuditReportExcelProps): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Deployment Audit System'
  workbook.created = props.generatedAt

  addSammendragSheet(workbook, props)
  addDeploymentsSheet(workbook, props.reportData.deployments, props.repository)
  addManualApprovalsSheet(workbook, props.reportData.manual_approvals, props.repository)
  addDeviationsSheet(workbook, props.reportData.deviations, props.repository)
  addUnverifiedCommitsSheet(workbook, props.reportData.unverified_commit_deployments, props.repository)

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}
