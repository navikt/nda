import type {
  RepositoryCodeDeliveryAncestryEvidence,
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
import type { ImplicitApprovalMode } from '~/lib/verification/types'

export interface RepositoryCodeDeliveryExport {
  schemaVersion: 3
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
  prSnapshots: RepositoryGitHubPrSnapshotExportRow[]
  commitSnapshots: RepositoryGitHubCommitSnapshotExportRow[]
  workflowRunSnapshots: RepositoryWorkflowRunSnapshotExportRow[]
  interpretationNotes: string[]
}

export function createRepositoryCodeDeliveryJson(
  data: Omit<RepositoryCodeDeliveryExport, 'schemaVersion' | 'exportedAt' | 'interpretationNotes'>,
  exportedAt = new Date(),
): string {
  const exportData: RepositoryCodeDeliveryExport = {
    schemaVersion: 3,
    exportedAt: exportedAt.toISOString(),
    ...data,
    interpretationNotes: [
      'Deployments are ordered by actual deployment timestamp, then NDA deployment ID.',
      'The unresolved row stores only its first and most recent observation timestamps; it does not store every retry.',
      'A matching GitHub compare snapshot is candidate evidence only. NDA does not directly link that snapshot to a specific unresolved retry.',
      'Compare snapshots may be absent because GitHub evidence archiving is best effort.',
      'Deployments without an assigned stable repository ID are not included. Deployments assigned to this repository are included even if their app lacks a known active or historical repository link.',
      'Only registered deliveries nearest to an included open unresolved deployment are included; registered but undeployed deliveries are not part of this diagnostic window.',
      'Nais initial history sync completion does not prove that GitHub ancestry or repository linkage is complete.',
      'The diagnostic includes every currently open unresolved deployment in scope; each target lists its two nearest deployed code deliveries before and after, and all deployments linked to those deliveries.',
      'Verification runs include every stored run for the included deployments. The result is the persisted decision evidence as recorded at run time; it is not recomputed from current settings or GitHub data.',
      'PR and commit snapshots include only snapshot IDs referenced by included verification runs. Workflow-run snapshots include archived versions referenced by trigger URLs on included deployments. Missing snapshots mean the source data was not archived or is no longer available; this export does not fetch live GitHub data.',
      'Ancestry compare snapshots are limited to the unresolved deployment and the selected neighboring deliveries; they do not establish that no other candidate delivery exists.',
      'implicitApprovalMode is read within the same repeatable-read database snapshot as the audit entries and exported evidence.',
      'Repository configuration audit entries include recorded changes only. An absent entry does not establish the setting value at a historical time, especially before repository-level audit logging or for settings initialized during repository backfill.',
      'implicitApprovalMode is the current value. Historical values can only be reconstructed where the audit log provides sufficient changes from a known starting value.',
    ],
  }

  return `${JSON.stringify(exportData, null, 2)}\n`
}
