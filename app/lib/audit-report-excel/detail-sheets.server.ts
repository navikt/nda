import type ExcelJS from 'exceljs'
import type {
  AdminResetEntry,
  DeviationEntry,
  ManualApprovalEntry,
  UnverifiedCommitDeploymentEntry,
} from '~/db/audit-reports.server'
import {
  addIntroRow,
  addWarningNoteRow,
  applyDataRow,
  applyHeaderRow,
  formatDateTime,
  formatUnverifiedReason,
  setDeploymentIdLink,
} from '~/lib/audit-report-excel/sheet-helpers.server'
import {
  DEVIATIONS_INTRO,
  MANUAL_APPROVALS_INTRO,
  UNVERIFIED_COMMITS_INTRO_EXCEL,
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

export function addManualApprovalsSheet(
  workbook: ExcelJS.Workbook,
  approvals: ManualApprovalEntry[],
  repository: string,
  teamSlug: string,
  environmentName: string,
  appName: string,
) {
  if (approvals.length === 0) return
  const sheet = workbook.addWorksheet('Godkjenninger i NDA')
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

    setDeploymentIdLink(row, 2, a.deployment_id, teamSlug, environmentName, appName)

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

export function addDeviationsSheet(
  workbook: ExcelJS.Workbook,
  deviations: DeviationEntry[],
  repository: string,
  teamSlug: string,
  environmentName: string,
  appName: string,
) {
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

    setDeploymentIdLink(row, 2, d.deployment_id, teamSlug, environmentName, appName)

    if (commitUrl) {
      row.getCell(4).value = { text: commitShort, hyperlink: commitUrl }
      row.getCell(4).font = { color: { argb: 'FF005B82' }, underline: true }
    }
  })

  sheet.autoFilter = { from: 'A2', to: 'L2' }
}

export function addUnverifiedCommitsSheet(
  workbook: ExcelJS.Workbook,
  entries: UnverifiedCommitDeploymentEntry[],
  showNote: boolean,
  _repository: string,
  teamSlug: string,
  environmentName: string,
  appName: string,
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

  addIntroRow(sheet, UNVERIFIED_COMMITS_INTRO_EXCEL, 11)
  if (showNote) {
    addWarningNoteRow(sheet, UNVERIFIED_COMMITS_NOTE, 11)
  }

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

      setDeploymentIdLink(row, 2, entry.deployment_id, teamSlug, environmentName, appName)

      row.getCell(7).value = { text: commitShort, hyperlink: commit.html_url }
      row.getCell(7).font = { color: { argb: 'FF005B82' }, underline: true }

      if (isApproved) {
        row.getCell(6).font = { color: { argb: 'FF006A2E' }, bold: true }
      } else {
        row.getCell(6).font = { color: { argb: 'FFBA3A26' }, bold: true }
      }
    }
  })

  sheet.autoFilter = { from: `A${showNote ? 3 : 2}`, to: `K${showNote ? 3 : 2}` }
}

export function addAdminResetsSheet(
  workbook: ExcelJS.Workbook,
  entries: AdminResetEntry[],
  teamSlug: string,
  environmentName: string,
  appName: string,
) {
  if (entries.length === 0) return
  const sheet = workbook.addWorksheet('Tilbakestillinger')
  sheet.columns = [{ width: 6 }, { width: 14 }, { width: 20 }, { width: 30 }, { width: 60 }]

  addIntroRow(
    sheet,
    'Deployments der verifiseringsstatusen ble tilbakestilt av administrator for å muliggjøre re-verifisering.',
    5,
  )

  const headerRow = sheet.addRow(['#', 'Deployment ID', 'Tidspunkt', 'Tilbakestilt av', 'Begrunnelse'])
  applyHeaderRow(sheet, headerRow)

  entries.forEach((entry, idx) => {
    const row = sheet.addRow([
      idx + 1,
      entry.deployment_id,
      formatDateTime(entry.reset_at),
      entry.reset_by,
      entry.reason,
    ])
    applyDataRow(row)
    setDeploymentIdLink(row, 2, entry.deployment_id, teamSlug, environmentName, appName)
  })

  sheet.autoFilter = { from: 'A2', to: 'E2' }
}
