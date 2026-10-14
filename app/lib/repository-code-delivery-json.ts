import type {
  RepositoryCodeDeliveryAncestryEvidence,
  RepositoryCodeDeliveryExportRow,
  RepositoryHistoryReadiness,
} from '~/db/repository-code-delivery-overview.server'

export interface RepositoryCodeDeliveryExport {
  schemaVersion: 1
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
  deployments: RepositoryCodeDeliveryExportRow[]
  ancestryEvidence: {
    matchingCompareSnapshots: RepositoryCodeDeliveryAncestryEvidence[]
    linkageNote: string
  }
  interpretationNotes: string[]
}

export function createRepositoryCodeDeliveryJson(
  data: Omit<RepositoryCodeDeliveryExport, 'schemaVersion' | 'exportedAt' | 'interpretationNotes'>,
  exportedAt = new Date(),
): string {
  const exportData: RepositoryCodeDeliveryExport = {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    ...data,
    interpretationNotes: [
      'Deployments are ordered by actual deployment timestamp, then NDA deployment ID.',
      'The unresolved row stores only its first and most recent observation timestamps; it does not store every retry.',
      'A matching GitHub compare snapshot is candidate evidence only. NDA does not directly link that snapshot to a specific unresolved retry.',
      'Compare snapshots may be absent because GitHub evidence archiving is best effort.',
      'Apps without a stable repository-ID link are not included in the deployment list, even when an owner/name match may exist.',
      'Nais initial history sync completion does not prove that GitHub ancestry or repository linkage is complete.',
    ],
  }

  return `${JSON.stringify(exportData, null, 2)}\n`
}
