import type { RepositoryAssessmentDiagnostic } from '~/db/repository-assessment-diagnostic.server'
import type {
  RepositoryCodeDeliveryAncestryEvidence,
  RepositoryCodeDeliveryDiagnosticDeliveryTarget,
  RepositoryCodeDeliveryDiagnosticTarget,
  RepositoryCodeDeliveryExportDelivery,
  RepositoryCodeDeliveryExportRow,
  RepositoryConfigAuditExportRow,
  RepositoryGitHubCommitSnapshotExportRow,
  RepositoryGitHubPrSnapshotExportRow,
  RepositoryHistoryReadiness,
  RepositoryVerificationRunExportRow,
  RepositoryWorkflowRunSnapshotExportRow,
} from '~/db/repository-code-delivery-overview.server'
import type { RepositoryDiagnosticGitHubEvidence } from '~/lib/github/repository-diagnostic-evidence.server'
import type { ImplicitApprovalMode } from '~/lib/verification/types'

export interface RepositoryCodeDeliveryExport {
  schemaVersion: 6
  repositoryAssessments: RepositoryAssessmentDiagnostic
  exportedAt: string
  repository: {
    id: number
    githubRepositoryId: string
    owner: string
    name: string
    defaultBranch: string | null
    trackingSince: Date | null
    auditStartYear: number | null
  }
  historyReadiness: RepositoryHistoryReadiness
  implicitApprovalMode: ImplicitApprovalMode
  deployments: RepositoryCodeDeliveryExportRow[]
  deliveries: RepositoryCodeDeliveryExportDelivery[]
  ancestryEvidence: {
    matchingCompareSnapshots: RepositoryCodeDeliveryAncestryEvidence[]
    linkageNote: string
  }
  verificationRuns: RepositoryVerificationRunExportRow[]
  repositoryConfigAuditLog: RepositoryConfigAuditExportRow[]
  diagnosticTargets: RepositoryCodeDeliveryDiagnosticTarget[]
  deliveryTarget: RepositoryCodeDeliveryDiagnosticDeliveryTarget | null
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[]
  commitSnapshots: RepositoryGitHubCommitSnapshotExportRow[]
  workflowRunSnapshots: RepositoryWorkflowRunSnapshotExportRow[]
  liveGitHubEvidence: RepositoryDiagnosticGitHubEvidence
  interpretationNotes: string[]
}

export function createRepositoryCodeDeliveryJson(
  data: Omit<RepositoryCodeDeliveryExport, 'schemaVersion' | 'exportedAt' | 'interpretationNotes'>,
  exportedAt = new Date(),
): string {
  const deliveryScoped = data.deliveryTarget !== null
  const exportData: RepositoryCodeDeliveryExport = {
    schemaVersion: 6,
    exportedAt: exportedAt.toISOString(),
    ...data,
    interpretationNotes: [
      'Deployments are ordered by actual deployment timestamp, then NDA deployment ID.',
      'Deployments without an assigned stable repository ID are not included. Deployments assigned to this repository are included even if their app lacks a known active or historical repository link.',
      'Nais initial history sync completion does not prove that GitHub ancestry or repository linkage is complete.',
      'Verification runs include every stored run for the included deployments. The result is the persisted decision evidence as recorded at run time; it is not recomputed from current settings or GitHub data.',
      'PR and commit snapshots include only snapshot IDs referenced by included verification runs. Workflow-run snapshots include archived versions referenced by trigger URLs on included deployments.',
      'repositoryAssessments contains current repository interval and approval evaluations for the included deliveries, not persisted application verification decisions. evaluationInput records the settings and normalized evidence used by the repository evaluator.',
      'repositoryAssessments snapshots are the exact raw snapshots referenced by the interval evaluator, including comparison, commit-to-PR associations, PR metadata, commits, reviews and stack comparisons. They are separate from application prSnapshots and commitSnapshots and from liveGitHubEvidence.',
      'Repository assessments, author identities, manual approval history and assessmentSync are read in the same repeatable-read snapshot as the export. A null assessmentSync means no queue record exists; empty snapshot lists mean no referenced snapshots were available, not that no review exists on GitHub.',
      'liveGitHubEvidence is fetched from GitHub when the export is generated and includes current PR metadata, review records, and workflow job/step outcomes for PRs and workflow runs referenced by the bounded diagnostic. It is not the verification decision stored at deployment time. Each item records its fetch status; missing or failed live evidence must not be interpreted as an empty review or job history.',
      'Workflow evidence discovered from a deployment trigger URL records the contributing deployment IDs. URLs that specify an Actions attempt fetch only that attempt; URLs without an attempt fetch jobs across all attempts, each with its runAttempt value.',
      'GitHub 404/410 responses are recorded as not_found and do not prove that a review or workflow run never existed; GitHub may also return 404 when the authenticated integration cannot access a resource.',
      'Live GitHub evidence is collected sequentially with a maximum of 100 API requests per export. The requestLimit, requestsAttempted, and per-item fetch statuses make truncation explicit.',
      'implicitApprovalMode is read within the same repeatable-read database snapshot as the audit entries and exported evidence.',
      'Repository configuration audit entries include recorded changes only. An absent entry does not establish the setting value at a historical time, especially before repository-level audit logging or for settings initialized during repository backfill.',
      'implicitApprovalMode is the current value. Historical values can only be reconstructed where the audit log provides sufficient changes from a known starting value.',
      ...(deliveryScoped
        ? [
            'This export is scoped to the selected registered delivery and includes every deployment linked to it. It does not include neighboring deliveries or unlinked deployments.',
            'Ancestry compare snapshots are not included because this export has no unresolved deployment target to compare against the selected delivery.',
          ]
        : [
            'The unresolved row stores only its first and most recent observation timestamps; it does not store every retry.',
            'A matching GitHub compare snapshot is candidate evidence only. NDA does not directly link that snapshot to a specific unresolved retry.',
            'Compare snapshots may be absent because GitHub evidence archiving is best effort.',
            'Only registered deliveries nearest to an included open unresolved deployment are included; registered but undeployed deliveries are not part of this diagnostic window.',
            'The diagnostic includes every currently open unresolved deployment in scope; each target lists its two nearest deployed code deliveries before and after, and all deployments linked to those deliveries.',
            'Ancestry compare snapshots are limited to the unresolved deployment and the selected neighboring deliveries; they do not establish that no other candidate delivery exists.',
          ]),
    ],
  }

  return `${JSON.stringify(exportData, null, 2)}\n`
}
