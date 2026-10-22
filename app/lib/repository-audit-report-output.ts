import { assessRepositoryAuditReadiness, type RepositoryAuditReportData } from './repository-audit-report'

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

interface ReportSection {
  title: string
  headers: string[]
  rows: string[][]
}

export function buildRepositoryReportSections(props: RepositoryReportOutputProps): ReportSection[] {
  const { reportData } = props
  if (!assessRepositoryAuditReadiness(reportData).isReady) {
    throw new Error('Repository report is not ready for export.')
  }
  const sections: ReportSection[] = [
    {
      title: 'Sammendrag',
      headers: ['Felt', 'Verdi'],
      rows: [
        ['Vurderingsmodell', 'Repositorybasert vurdering'],
        ['Applikasjon', props.appName],
        ['Team / miljø', `${props.teamSlug} / ${props.environmentName}`],
        ['Periode', props.periodLabel ?? `${reportData.period.start} – ${reportData.period.end}`],
        ['Fra / til', `${reportData.period.start} – ${reportData.period.end}`],
        ['Dokument-ID', props.reportId],
        ['Generert', props.generatedAt.toISOString()],
        ['Vurdert', reportData.assessedAt],
        ['Format / verifiseringsversjon', `${reportData.schemaVersion} / ${reportData.verificationSchemaVersion}`],
        ['SHA256', props.contentHash],
        ['Deployments', String(reportData.deployments.length)],
        ['Unike kodeleveranser', String(reportData.deliveries.length)],
        [
          'Grunnlag',
          'Lagret evidens ved generering, inkludert etterkontroll. Ikke en vurdering kun av det som var kjent ved deployment.',
        ],
        [
          'Konklusjon',
          reportData.deployments.length === 0
            ? 'Ingen deployments registrert i perioden.'
            : 'Kodedekning og deploymentkilde oppfyller rapportkravene.',
        ],
      ],
    },
    {
      title: 'Deployments',
      headers: ['Deployment / tidspunkt', 'Kodeleveranse / SHA', 'Branch / trigger', 'Repositorytillatelse / workflow'],
      rows: reportData.deployments.map((deployment) => [
        `${deployment.id} / ${deployment.naisDeploymentId}\n${deployment.createdAt}\nDeployer: ${deployment.deployerUsername ?? 'Ukjent'}`,
        `${deployment.deliveryId}\n${deployment.commitSha}`,
        `${deployment.source.branch} / ${deployment.source.defaultBranch}\n${deployment.source.triggerEvent}\n${deployment.source.triggerUrl}`,
        `Kobling ${deployment.source.repositoryAuthorization?.linkId}: ${deployment.source.repositoryAuthorization?.status}\nSnapshot ${deployment.source.workflowSnapshot?.id}, run ${deployment.source.workflowSnapshot?.runId}, forsøk ${deployment.source.workflowSnapshot?.runAttempt ?? 'ukjent'}\n${deployment.source.workflowSnapshot?.fetchedAt}`,
      ]),
    },
  ]
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
        ['Kodedekning', delivery.assessment.status],
        ['Antall commits', String(delivery.assessment.totalCommits)],
        ['Implisitt godkjenning', delivery.evidence.implicitApprovalMode],
        ['Default branch', delivery.evidence.defaultBranch ?? 'Ukjent'],
      ],
    })
    deliverySections.push({
      title: 'Commits',
      headers: ['SHA / forfatter', 'Tittel', 'Dekning / grunnlag', 'PR'],
      rows: delivery.assessment.commits.map((commit) => {
        const intervalCommit = delivery.interval.commits.find((item) => item.sha === commit.sha)
        return [
          `${commit.sha}\n${intervalCommit?.authorLogin ?? 'Ukjent'}`,
          intervalCommit?.message ?? '',
          `${commit.status} / ${commit.reason}\nPR-vurdering: ${intervalCommit?.reason ?? 'ukjent'}`,
          intervalCommit?.pullRequestNumber == null ? '' : String(intervalCommit.pullRequestNumber),
        ]
      }),
    })
    const pullRequests = Object.values(delivery.evidence.pullRequestsByNumber).filter((pr) => pr != null)
    deliverySections.push({
      title: 'PR-evidens',
      headers: ['PR / head', 'Forfatter / merge', 'Review / tidspunkt', 'Tilstand / commit'],
      rows: pullRequests.flatMap((pr) => [
        [
          `#${pr.number}\n${pr.headSha ?? 'Ukjent'}\n${pr.baseBranch}`,
          `${pr.authorLogin ?? 'Ukjent'} / ${pr.mergedByLogin ?? 'Ukjent'}\n${pr.mergedAt ?? 'Ukjent'}`,
          '',
          '',
        ],
        ...(pr.reviews ?? []).map((review) => [
          `#${pr.number}`,
          '',
          `${review.username}\n${review.submittedAt}`,
          `${review.state}\n${review.commitId ?? ''}`,
        ]),
      ]),
    })
    deliverySections.push({
      title: 'Manuell historikk',
      headers: ['SHA / forfatter', 'Kontrollør / registrert av', 'Kontrollert / registrert', 'Status / dokumentasjon'],
      rows: delivery.manualApprovals.map((approval) => [
        `${approval.sha}\n${approval.authorLogin ?? ''} / ${approval.authorNavIdent ?? ''}`,
        `${approval.reviewerNavIdent} / ${approval.registeredByNavIdent}`,
        `${approval.reviewedAt}\n${approval.registeredAt}`,
        `${approval.status}\n${approval.documentation ?? ''}\nGodkjenning ${approval.id}, snapshot ${approval.snapshotId}`,
      ]),
    })
    deliverySections.push({
      title: 'Kilder',
      headers: ['Kildetype', 'Snapshot-ID / hentet'],
      rows: Object.entries(delivery.sources).flatMap(([kind, snapshots]) =>
        snapshots.map((snapshot) => [kind, `${snapshot.id} / ${snapshot.fetchedAt}`]),
      ),
    })
    deliverySections.push({
      title: 'Identiteter',
      headers: ['GitHub / Nav-ident', 'Kontoversjon', 'Identitetsversjon', 'Konto slettet'],
      rows: delivery.authorIdentities.map((identity) => [
        `${identity.githubUsername} / ${identity.activeNavIdent ?? 'Ukjent'}`,
        identity.accountIdentityVersion,
        identity.userIdentityVersion ?? 'Ukjent',
        identity.accountDeletedAt ?? '',
      ]),
    })
    for (const section of deliverySections) {
      const existing = sections.find((item) => item.title === section.title)
      const rows = section.rows.map((row) => [String(delivery.id), ...row])
      if (existing) existing.rows.push(...rows)
      else sections.push({ ...section, headers: ['Kodeleveranse', ...section.headers], rows })
    }
  }
  return sections
}
