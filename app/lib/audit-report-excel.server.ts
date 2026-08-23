import ExcelJS from 'exceljs'
import type { AuditDeploymentEntry, AuditReportData } from '~/db/audit-reports.server'
import {
  addAdminResetsSheet,
  addDeviationsSheet,
  addManualApprovalsSheet,
  addUnverifiedCommitsSheet,
} from '~/lib/audit-report-excel/detail-sheets.server'
import {
  applyDataRow,
  applyHeaderRow,
  formatDateTime,
  setDeploymentIdLink,
} from '~/lib/audit-report-excel/sheet-helpers.server'
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

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`
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

function addDeploymentsSheet(
  workbook: ExcelJS.Workbook,
  deployments: AuditDeploymentEntry[],
  repository: string,
  teamSlug: string,
  environmentName: string,
  appName: string,
) {
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

    setDeploymentIdLink(row, 2, d.id, teamSlug, environmentName, appName)

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

export async function generateAuditReportExcel(props: AuditReportExcelProps): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Deployment Audit System'
  workbook.created = props.generatedAt

  addSammendragSheet(workbook, props)
  addDeploymentsSheet(
    workbook,
    props.reportData.deployments,
    props.repository,
    props.teamSlug,
    props.environmentName,
    props.appName,
  )
  addManualApprovalsSheet(
    workbook,
    props.reportData.manual_approvals,
    props.repository,
    props.teamSlug,
    props.environmentName,
    props.appName,
  )
  addDeviationsSheet(
    workbook,
    props.reportData.deviations,
    props.repository,
    props.teamSlug,
    props.environmentName,
    props.appName,
  )
  addAdminResetsSheet(workbook, props.reportData.admin_resets, props.teamSlug, props.environmentName, props.appName)
  addUnverifiedCommitsSheet(
    workbook,
    props.reportData.unverified_commit_deployments,
    props.reportData.show_unverified_commits_note,
    props.repository,
    props.teamSlug,
    props.environmentName,
    props.appName,
  )

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}
