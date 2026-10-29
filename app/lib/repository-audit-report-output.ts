import { DEVIATIONS_INTRO, ndaDeploymentUrl } from './audit-report-texts'
import { computeDisplayTitle, isExclusivelyThisPr } from './delivery-title'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
} from './deviation-constants'
import { assessRepositoryAuditReadiness, type RepositoryAuditReportData } from './repository-audit-report'
import { approvalCommitReasonLabel, approvalStatusLabel } from './repository-code-delivery/approval-assessment-display'
import { assessmentReasonLabel } from './repository-code-delivery/interval-assessment-display'
import { IMPLICIT_APPROVAL_MODE_LABELS, isImplicitApprovalMode } from './verification/types'
import { verifyFourEyesFromPrData } from './verification/verify'
import { getWorkflowTriggerLabel } from './workflow-trigger-label'

export interface RepositoryReportOutputProps {
  appName: string
  teamSlug: string
  environmentName: string
  periodLabel?: string
  periodStart: Date
  periodEnd: Date
  reportData: RepositoryAuditReportData
  contentHash: string
  reportId: string
  generatedAt: Date
}

export interface ReportSection {
  title: string
  headers: string[]
  rows: string[][]
  cellLinks?: Record<number, Record<number, string>>
}

const OMITTED_REPOSITORY_REPORT_DETAIL_SECTIONS = new Set([
  'Kodeleveranser',
  'Commits',
  'PR-evidens',
  'Kilder',
  'Identiteter',
])

export function filterRepositoryReportSectionsForExport(sections: ReportSection[]): ReportSection[] {
  return sections.filter((section) => !OMITTED_REPOSITORY_REPORT_DETAIL_SECTIONS.has(section.title))
}

export function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function repositoryDeploymentUrl(props: RepositoryReportOutputProps, deploymentId: number): string {
  return `${ndaDeploymentUrl(props.teamSlug, props.environmentName, props.appName, deploymentId)}?view=repository`
}

export const REPOSITORY_REPORT_SECTION_INTRODUCTIONS: Record<string, string> = {
  Deployments:
    'Deployments er listet separat. Kodeleveransen vurderes én gang per repositoryintervall og kan være felles for flere deployments.',
  Kodeleveranser: 'Unike kodeleveranser med låst base/head, repositoryidentitet og samlet vurdering.',
  Commits: 'Commitstatus og årsak for hvert commit i kodeleveransens sammenligningsintervall.',
  'PR-evidens': 'Pull request- og reviewgrunnlag lagret ved genereringstidspunktet.',
  'Manuell historikk': 'Kontrolltidspunkt, registreringstidspunkt og gyldighetsstatus for manuelle godkjenninger.',
  Kilder: 'Referanser til lagrede snapshots som inngår i rapportens vurdering.',
  Identiteter: 'GitHub-kontokoblinger og identitetsversjoner brukt i vurderingen.',
  Avvik: DEVIATIONS_INTRO,
}

export const REPOSITORY_REPORT_INTRO =
  'Rapporten gjelder applikasjonens deployments i perioden. Kodedekning vurderes samlet per unik repositoryleveranse på grunnlag av lagret evidens ved generering, inkludert etterkontroll.'

type ReportRow = [label: string, value: string]

export interface RepositoryReportSummary {
  metadata: ReportRow[]
  values: ReportRow[]
  context: ReportRow[]
}

export function formatRepositoryReportDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleDateString('nb-NO', {
    timeZone: 'Europe/Oslo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatRepositoryReportDateTime(value: Date | string | null | undefined): string {
  if (!value) return 'Ukjent'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return value instanceof Date ? value.toISOString() : value
  return date.toLocaleString('nb-NO', {
    timeZone: 'Europe/Oslo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatManualApprovalStatus(value: string): string {
  const labels: Record<string, string> = {
    eligible: 'Gyldig',
    revoked: 'Tilbakekalt',
    identity_or_interval_changed: 'Identitet eller intervall er endret',
  }
  return labels[value] ?? value
}

function formatReviewState(value: string): string {
  const labels: Record<string, string> = {
    APPROVED: 'Godkjent',
    CHANGES_REQUESTED: 'Endringer forespurt',
    COMMENTED: 'Kommentert',
    DISMISSED: 'Review trukket tilbake',
    PENDING: 'Avventer',
  }
  return labels[value.toUpperCase()] ?? value
}

function formatImplicitApprovalMode(value: string): string {
  return isImplicitApprovalMode(value) ? IMPLICIT_APPROVAL_MODE_LABELS[value] : value
}

function formatRepositoryAuthorization(value: string | null | undefined): string {
  if (!value) return 'Ukjent'
  const labels: Record<string, string> = {
    active: 'Aktiv',
    historical: 'Historisk',
    pending_approval: 'Venter på godkjenning',
    unknown: 'Ukjent',
  }
  return labels[value] ?? value
}

function displayName(reportData: RepositoryAuditReportData, identity: string | null | undefined): string {
  if (!identity) return 'Ukjent'
  const names = reportData.userDisplayNames ?? {}
  return names[identity.toLowerCase()] ?? names[identity.toUpperCase()] ?? identity
}

function labelFromMap(labels: object, value: string | null): string {
  if (!value) return 'Ukjent'
  return Object.entries(labels).find(([key]) => key === value)?.[1] ?? value
}

function formatSourceKind(value: string): string {
  const labels: Record<string, string> = {
    comparisons: 'Sammenligning',
    associations: 'Pull request-kobling',
    pullRequests: 'Pull request',
    stackComparisons: 'Stack-sammenligning',
  }
  return labels[value] ?? value
}

function appendDeliverySection(sections: ReportSection[], section: ReportSection, deliveryId: number): void {
  const existing = sections.find((item) => item.title === section.title)
  const rows = section.rows.map((row) => [String(deliveryId), ...row])
  const rowOffset = existing?.rows.length ?? 0
  const cellLinks = Object.fromEntries(
    Object.entries(section.cellLinks ?? {}).map(([row, links]) => [
      rowOffset + Number(row),
      Object.fromEntries(Object.entries(links).map(([column, url]) => [Number(column) + 1, url])),
    ]),
  )
  if (existing) {
    existing.rows.push(...rows)
    if (Object.keys(cellLinks).length > 0) existing.cellLinks = { ...existing.cellLinks, ...cellLinks }
    return
  }
  sections.push({
    ...section,
    headers: ['Kodeleveranse', ...section.headers],
    rows,
    ...(Object.keys(cellLinks).length > 0 ? { cellLinks } : {}),
  })
}

function eligibleGithubReviewers(delivery: RepositoryAuditReportData['deliveries'][number]): string[] {
  const { evidence } = delivery
  const coveredPullRequestNumbers = new Set(
    delivery.interval.commits
      .filter(
        (commit) =>
          commit.status === 'covered' &&
          (commit.reason === 'approved_review' || commit.reason === 'implicit_approval') &&
          commit.pullRequestNumber !== null,
      )
      .map((commit) => commit.pullRequestNumber),
  )
  return Object.values(evidence.pullRequestsByNumber).flatMap((pullRequest) => {
    const commits = pullRequest?.commits
    const reviews = pullRequest?.reviews
    if (
      !pullRequest ||
      (pullRequest.baseBranch !== evidence.defaultBranch && !coveredPullRequestNumbers.has(pullRequest.number)) ||
      pullRequest.headSha === null ||
      pullRequest.commitCount === null ||
      !commits ||
      !reviews ||
      pullRequest.commitCount !== commits.length ||
      commits[commits.length - 1]?.sha !== pullRequest.headSha
    ) {
      return []
    }

    return reviews.flatMap((review) => {
      if (review.state !== 'APPROVED') return []
      const result = verifyFourEyesFromPrData({
        reviewers: [review],
        commits,
        baseBranch: pullRequest.baseBranch,
        mergedBy: pullRequest.mergedByLogin,
        prCreator: pullRequest.authorLogin ?? undefined,
        implicitApprovalMode: evidence.implicitApprovalMode,
      })
      return result.hasFourEyes ? [review.username.trim().toLowerCase()] : []
    })
  })
}

export function buildRepositoryDeploymentApproval(reportData: RepositoryAuditReportData, deliveryId: number | null) {
  const delivery = reportData.deliveries.find((item) => item.id === deliveryId)
  if (!delivery) {
    throw new Error(`Missing report delivery ${deliveryId}`)
  }
  const prCommits = delivery.assessment.commits.filter(
    (commit) => commit.status === 'covered' && commit.reason === 'approved_pr',
  )
  const pullRequestNumbers = new Set(
    prCommits.flatMap((commit) => {
      const intervalCommit = delivery.interval.commits.find((item) => item.sha === commit.sha)
      return intervalCommit?.pullRequestNumber == null ? [] : [intervalCommit.pullRequestNumber]
    }),
  )
  const manualCommits = new Set(
    delivery.assessment.commits
      .filter((commit) => commit.status === 'covered' && commit.reason === 'manual_approval')
      .map((commit) => commit.sha.toLowerCase()),
  )
  const approvals = delivery.manualApprovals.filter(
    (approval) =>
      approval.status === 'eligible' &&
      manualCommits.has(approval.sha.toLowerCase()) &&
      delivery.interval.commits.some(
        (commit) =>
          commit.sha.toLowerCase() === approval.sha.toLowerCase() &&
          commit.authorLogin?.toLowerCase() === approval.authorLogin?.toLowerCase(),
      ) &&
      approval.authorNavIdent !== null &&
      approval.reviewerNavIdent.toLowerCase() !== approval.authorNavIdent.toLowerCase() &&
      delivery.authorIdentities.some(
        (identity) =>
          identity.githubUsername.toLowerCase() === approval.authorLogin?.toLowerCase() &&
          identity.activeNavIdent === approval.authorNavIdent,
      ),
  )
  const names = (identities: Array<string | null | undefined>) =>
    [...new Set(identities.map((identity) => displayName(reportData, identity)))].join('\n') || '—'
  const githubApprovers = Array.from(pullRequestNumbers).flatMap((number) => {
    const pr = delivery.evidence.pullRequestsByNumber[number]
    if (!pr?.commits || !pr.reviews) return []
    const result = verifyFourEyesFromPrData({
      reviewers: pr.reviews,
      commits: pr.commits,
      baseBranch: pr.baseBranch,
      mergedBy: pr.mergedByLogin,
      prCreator: pr.authorLogin ?? undefined,
      implicitApprovalMode: delivery.evidence.implicitApprovalMode,
    })
    if (!result.hasFourEyes) return []
    if (result.method === 'implicit') {
      return [
        ...pr.reviews.filter((review) => review.state === 'APPROVED').map((review) => review.username),
        ...(pr.mergedByLogin ? [pr.mergedByLogin] : []),
      ]
    }
    return pr.reviews.flatMap((review) => {
      const reviewResult = verifyFourEyesFromPrData({
        reviewers: [review],
        commits: pr.commits ?? [],
        baseBranch: pr.baseBranch,
        implicitApprovalMode: 'off',
      })
      return reviewResult.hasFourEyes ? [review.username] : []
    })
  })
  return {
    method:
      [prCommits.length > 0 ? 'PR' : null, manualCommits.size > 0 ? 'Manuell' : null].filter(Boolean).join(' + ') ||
      'Ukjent',
    references: [
      ...Array.from(pullRequestNumbers).map((number) => ({
        label: `PR #${number}`,
        url: `https://github.com/${delivery.githubOwner}/${delivery.githubRepoName}/pull/${number}`,
      })),
      ...Array.from(new Set(approvals.map((approval) => approval.id))).map((id) => ({
        label: `Manuell #${id}`,
        url: null,
      })),
    ],
    authors: names(
      Array.from(pullRequestNumbers).map((number) => delivery.evidence.pullRequestsByNumber[number]?.authorLogin),
    ),
    approvers: names([...githubApprovers, ...approvals.map((approval) => approval.reviewerNavIdent)]),
  }
}

export function buildRepositoryReportSummary(props: RepositoryReportOutputProps): RepositoryReportSummary {
  const { reportData } = props
  const deviations = reportData.deviations ?? []
  const testRequirement = reportData.app.testRequirement ?? 'none'
  const repositories = [
    ...new Set(reportData.deliveries.map((delivery) => `${delivery.githubOwner}/${delivery.githubRepoName}`)),
  ]
  const contributors = new Set(
    reportData.deliveries.flatMap((delivery) =>
      [
        ...delivery.interval.commits.map((commit) =>
          (commit.authorLogin ?? commit.authorUsername).trim().toLowerCase(),
        ),
        ...delivery.authorIdentities.map((identity) => identity.githubUsername.trim().toLowerCase()),
      ].filter(Boolean),
    ),
  )
  const githubReviewers = new Set(reportData.deliveries.flatMap(eligibleGithubReviewers).filter(Boolean))
  const manualReviewers = new Set(
    reportData.deliveries
      .flatMap((delivery) =>
        delivery.manualApprovals
          .filter((approval) => approval.status === 'eligible')
          .map((approval) => approval.reviewerNavIdent.trim().toLowerCase()),
      )
      .filter(Boolean),
  )
  const approvedDeliveryCount = reportData.deliveries.filter(
    (delivery) => delivery.assessment.status === 'approved',
  ).length
  const periodRange = `${formatRepositoryReportDate(props.periodStart)} – ${formatRepositoryReportDate(props.periodEnd)}`
  return {
    metadata: [
      ['Vurderingsmodell', 'Repositorybasert vurdering'],
      ['Applikasjon', props.appName],
      ['Repository', repositories.join(', ') || 'Ingen repositoryleveranser i perioden'],
      ['Team', props.teamSlug],
      ['Miljø', props.environmentName],
      ['Periode', `${props.periodLabel ? `${props.periodLabel} — ` : ''}${periodRange}`],
      ['Dokument-ID', props.reportId],
      ['Generert', formatRepositoryReportDateTime(props.generatedAt)],
      ['Vurdert', formatRepositoryReportDateTime(reportData.assessedAt)],
      ['Format / verifiseringsversjon', `${reportData.schemaVersion} / ${reportData.verificationSchemaVersion}`],
      ['SHA256', props.contentHash],
    ],
    values: [
      ['Status', 'GODKJENT'],
      ['Totalt antall deployments', String(reportData.deployments.length)],
      ['Repositoryer i grunnlaget', String(repositories.length)],
      ['Unike kodeleveranser', String(reportData.deliveries.length)],
      ['Kodeleveranser med full dekning', `${approvedDeliveryCount} av ${reportData.deliveries.length}`],
      ['Unike bidragsytere', `${contributors.size} ${contributors.size === 1 ? 'person' : 'personer'}`],
      [
        'Unike reviewers',
        `${githubReviewers.size} ${githubReviewers.size === 1 ? 'GitHub-konto' : 'GitHub-kontoer'} / ${manualReviewers.size} ${manualReviewers.size === 1 ? 'NAV-ident' : 'NAV-identer'}`,
      ],
      [
        'Registrerte avvik',
        `${deviations.length} (${deviations.filter((deviation) => !deviation.resolvedAt).length} åpne)`,
      ],
    ],
    context: [
      [
        'Grunnlag',
        'Lagret evidens ved generering, inkludert etterkontroll. Ikke en vurdering kun av det som var kjent ved deployment.',
      ],
      [
        'Konklusjon',
        reportData.deployments.length === 0
          ? 'Ingen deployments registrert i perioden.'
          : deviations.length > 0
            ? 'Kodedekning og deploymentkilde oppfyller rapportkravene. Registrerte avvik er vist separat.'
            : 'Kodedekning og deploymentkilde oppfyller rapportkravene.',
      ],
      [
        'Testkrav',
        testRequirement === 'unit_tests'
          ? 'Enhetstester'
          : testRequirement === 'integration_tests'
            ? 'Integrasjonstester'
            : testRequirement === 'none'
              ? 'Ingen særskilte testkrav'
              : `Ukjent (${testRequirement})`,
      ],
    ],
  }
}

export function buildRepositoryReportSections(
  props: RepositoryReportOutputProps,
  summary = buildRepositoryReportSummary(props),
): ReportSection[] {
  const { reportData } = props
  const deviations = reportData.deviations ?? []
  if (!assessRepositoryAuditReadiness(reportData).isReady) {
    throw new Error('Repository report is not ready for export.')
  }
  const deploymentCellLinks: Record<number, Record<number, string>> = {}
  const sections: ReportSection[] = [
    {
      title: 'Sammendrag',
      headers: ['Felt', 'Verdi'],
      rows: [...summary.metadata, ...summary.values, ...summary.context],
    },
    {
      title: 'Deployments',
      headers: [
        'Deployment / tidspunkt',
        'Tittel / endringsopphav',
        'Kodeleveranse / SHA',
        'Branch / trigger',
        'Repositorytillatelse / workflow',
      ],
      rows: [],
      cellLinks: deploymentCellLinks,
    },
  ]
  const deploymentSection = sections[1]
  for (const deployment of reportData.deployments) {
    const delivery = reportData.deliveries.find((item) => item.id === deployment.deliveryId)
    const pullRequestNumber = deployment.pullRequestNumber ?? null
    const pullRequest = pullRequestNumber === null ? null : delivery?.evidence.pullRequestsByNumber[pullRequestNumber]
    const pullRequestCommitShas = pullRequest?.commits?.map((commit) => commit.sha) ?? null
    const deploymentTitle =
      computeDisplayTitle(
        deployment.title,
        delivery?.assessment.totalCommits ?? 1,
        isExclusivelyThisPr(
          pullRequestNumber !== null,
          delivery?.interval.commits.map((commit) => commit.sha) ?? [],
          pullRequestCommitShas ? new Set(pullRequestCommitShas) : null,
        ),
      ) ?? 'Ukjent'
    const rowIndex = deploymentSection.rows.length
    const goalLinks = (deployment.goalLinks ?? [])
      .map(
        (link) =>
          `${link.teamName} ${link.periodLabel} — ${link.objectiveTitle}${link.keyResultTitle ? ` → ${link.keyResultTitle}` : ''}`,
      )
      .join('; ')
    deploymentSection.rows.push([
      `${deployment.id} / ${deployment.naisDeploymentId}\n${formatRepositoryReportDateTime(deployment.createdAt)}\nDeployer: ${displayName(reportData, deployment.deployerUsername)}`,
      `${deploymentTitle}${goalLinks ? `\nEndringsopphav: ${goalLinks}` : ''}`,
      `${deployment.deliveryId ?? 'Ukjent'}\n${deployment.commitSha ?? 'Ukjent'}`,
      `${deployment.source.branch ?? 'Ukjent'} / ${deployment.source.defaultBranch ?? 'Ukjent'}\n${deployment.source.triggerEvent ? getWorkflowTriggerLabel(deployment.source.triggerEvent) : 'Ukjent'}`,
      `Kobling ${deployment.source.repositoryAuthorization?.linkId ?? 'ukjent'}: ${formatRepositoryAuthorization(deployment.source.repositoryAuthorization?.status)}\nSnapshot ${deployment.source.workflowSnapshot?.id ?? 'ukjent'}, run ${deployment.source.workflowSnapshot?.runId ?? 'ukjent'}, forsøk ${deployment.source.workflowSnapshot?.runAttempt ?? 'ukjent'}\n${formatRepositoryReportDateTime(deployment.source.workflowSnapshot?.fetchedAt)}`,
    ])
    const links: Record<number, string> = {
      0: repositoryDeploymentUrl(props, deployment.id),
    }
    if (delivery && deployment.commitSha) {
      links[2] = `https://github.com/${delivery.githubOwner}/${delivery.githubRepoName}/commit/${deployment.commitSha}`
    }
    if (deployment.source.triggerUrl) links[3] = deployment.source.triggerUrl
    deploymentCellLinks[rowIndex] = links
  }
  for (const delivery of reportData.deliveries) {
    const deliverySections: ReportSection[] = []
    deliverySections.push({
      title: 'Kodeleveranser',
      headers: ['Felt', 'Verdi'],
      rows: [
        ['Repository', `${delivery.githubOwner}/${delivery.githubRepoName}`],
        ['Repository-ID / GitHub-ID', `${delivery.repositoryId} / ${delivery.githubRepoId}`],
        ['Base (eksklusiv)', delivery.baseSha],
        ['Head (inklusiv)', delivery.headSha],
        ['Kodedekning', approvalStatusLabel(delivery.assessment.status)],
        ['Antall commits', String(delivery.assessment.totalCommits)],
        ['Implisitt godkjenning', formatImplicitApprovalMode(delivery.evidence.implicitApprovalMode)],
        ['Default branch', delivery.evidence.defaultBranch ?? 'Ukjent'],
      ],
      cellLinks: {
        2: { 1: `https://github.com/${delivery.githubOwner}/${delivery.githubRepoName}/commit/${delivery.baseSha}` },
        3: { 1: `https://github.com/${delivery.githubOwner}/${delivery.githubRepoName}/commit/${delivery.headSha}` },
      },
    })
    deliverySections.push({
      title: 'Commits',
      headers: ['SHA / forfatter', 'Tittel', 'Dekning / grunnlag', 'PR'],
      rows: delivery.assessment.commits.map((commit) => {
        const intervalCommit = delivery.interval.commits.find((item) => item.sha === commit.sha)
        return [
          `${commit.sha}\n${displayName(reportData, intervalCommit?.authorLogin ?? intervalCommit?.authorUsername)}`,
          intervalCommit?.message ?? '',
          `${commit.status === 'covered' ? 'Dekket' : commit.status === 'not_covered' ? 'Ikke dekket' : 'Uavklart'} / ${approvalCommitReasonLabel(commit.reason)}\nPR-vurdering: ${intervalCommit ? assessmentReasonLabel(intervalCommit.reason) : 'Ukjent'}`,
          intervalCommit?.pullRequestNumber == null ? '' : String(intervalCommit.pullRequestNumber),
        ]
      }),
      cellLinks: Object.fromEntries(
        delivery.assessment.commits.flatMap((commit, index) => {
          const intervalCommit = delivery.interval.commits.find((item) => item.sha === commit.sha)
          return intervalCommit?.htmlUrl ? [[index, { 0: intervalCommit.htmlUrl }]] : []
        }),
      ),
    })
    const pullRequests = Object.values(delivery.evidence.pullRequestsByNumber).filter((pr) => pr != null)
    const pullRequestRows: string[][] = []
    const pullRequestLinks: Record<number, Record<number, string>> = {}
    for (const pullRequest of pullRequests) {
      const rowIndex = pullRequestRows.length
      pullRequestRows.push([
        `#${pullRequest.number}\n${pullRequest.headSha ?? 'Ukjent'}\n${pullRequest.baseBranch}`,
        `${displayName(reportData, pullRequest.authorLogin)} / ${displayName(reportData, pullRequest.mergedByLogin)}`,
        `Sammenslått ${formatRepositoryReportDateTime(pullRequest.mergedAt)}`,
        '',
      ])
      pullRequestLinks[rowIndex] = {
        0: `https://github.com/${delivery.githubOwner}/${delivery.githubRepoName}/pull/${pullRequest.number}`,
      }
      for (const review of pullRequest.reviews ?? []) {
        pullRequestRows.push([
          `#${pullRequest.number}`,
          '',
          `${displayName(reportData, review.username)}\n${formatRepositoryReportDateTime(review.submittedAt)}`,
          `${formatReviewState(review.state)}\n${review.commitId ?? ''}`,
        ])
      }
    }
    deliverySections.push({
      title: 'PR-evidens',
      headers: ['PR / head SHA', 'Forfatter / merge', 'Review / tidspunkt', 'Tilstand / commit'],
      rows: pullRequestRows,
      cellLinks: pullRequestLinks,
    })
    const manualApprovalLinks: Record<number, Record<number, string>> = {}
    deliverySections.push({
      title: 'Manuell historikk',
      headers: ['SHA / forfatter', 'Kontrollør / registrert av', 'Kontrollert / registrert', 'Status / dokumentasjon'],
      rows: delivery.manualApprovals.map((approval, index) => {
        const links: Record<number, string> = {}
        if (/^[0-9a-f]{40}$/i.test(approval.sha)) {
          links[0] = `https://github.com/${delivery.githubOwner}/${delivery.githubRepoName}/commit/${approval.sha}`
        }
        if (approval.documentation && isHttpUrl(approval.documentation)) {
          links[3] = approval.documentation
        }
        if (Object.keys(links).length > 0) manualApprovalLinks[index] = links
        return [
          `${approval.sha}\n${displayName(reportData, approval.authorLogin)} / ${approval.authorNavIdent ?? ''}`,
          `${displayName(reportData, approval.reviewerNavIdent)} / ${displayName(reportData, approval.registeredByNavIdent)}`,
          `${formatRepositoryReportDateTime(approval.reviewedAt)}\n${formatRepositoryReportDateTime(approval.registeredAt)}`,
          `${formatManualApprovalStatus(approval.status)}\n${approval.documentation ?? ''}\nGodkjenning ${approval.id}, snapshot ${approval.snapshotId}`,
        ]
      }),
      cellLinks: manualApprovalLinks,
    })
    deliverySections.push({
      title: 'Kilder',
      headers: ['Kildetype', 'Snapshot-ID / hentet'],
      rows: Object.entries(delivery.sources).flatMap(([kind, snapshots]) =>
        snapshots.map((snapshot) => [
          formatSourceKind(kind),
          `${snapshot.id} / ${formatRepositoryReportDateTime(snapshot.fetchedAt)}`,
        ]),
      ),
    })
    deliverySections.push({
      title: 'Identiteter',
      headers: ['GitHub / Nav-ident', 'Kontoversjon', 'Identitetsversjon', 'Konto slettet'],
      rows: delivery.authorIdentities.map((identity) => [
        `${identity.githubUsername} / ${identity.activeNavIdent ?? 'Ukjent'}`,
        identity.accountIdentityVersion,
        identity.userIdentityVersion ?? 'Ukjent',
        identity.accountDeletedAt ? formatRepositoryReportDateTime(identity.accountDeletedAt) : 'Nei',
      ]),
    })
    for (const section of deliverySections) {
      appendDeliverySection(sections, section, delivery.id)
    }
  }
  if (deviations.length > 0) {
    const cellLinks: Record<number, Record<number, string>> = {}
    const rows = deviations.map((deviation, index) => {
      const links: Record<number, string> = {
        0: repositoryDeploymentUrl(props, deviation.deploymentId),
      }
      if (deviation.commitSha && deviation.githubOwner && deviation.githubRepoName) {
        links[1] = `https://github.com/${deviation.githubOwner}/${deviation.githubRepoName}/commit/${deviation.commitSha}`
      }
      cellLinks[index] = links
      return [
        `${deviation.deploymentId} / ${formatRepositoryReportDateTime(deviation.date)}`,
        `${deviation.title ?? 'Ukjent'}\nCommit: ${deviation.commitSha ?? 'Ukjent'}`,
        [
          `Beskrivelse: ${deviation.reason}`,
          `Type brudd: ${deviation.breachType ?? 'Ukjent'}`,
          `Intensjon: ${labelFromMap(DEVIATION_INTENT_LABELS, deviation.intent)}`,
          `Alvorlighetsgrad: ${labelFromMap(DEVIATION_SEVERITY_LABELS, deviation.severity)}`,
          `Oppfølgingsansvarlig: ${labelFromMap(DEVIATION_FOLLOW_UP_ROLE_LABELS, deviation.followUpRole)}`,
          `Registrert av: ${deviation.registeredByName ?? displayName(reportData, deviation.registeredBy)}`,
        ].join('\n'),
        deviation.resolvedAt
          ? `Løst ${formatRepositoryReportDateTime(deviation.resolvedAt)}${deviation.resolutionNote ? `\n${deviation.resolutionNote}` : ''}`
          : 'Åpen',
      ]
    })
    sections.push({
      title: 'Avvik',
      headers: ['Deployment / dato', 'Tittel / commit', 'Avvik', 'Oppfølging'],
      rows,
      cellLinks,
    })
  }
  return sections
}
