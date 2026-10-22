export type AuditReportAssessmentModel = 'application' | 'repository'

export const AUDIT_REPORT_MODEL_LABELS: Record<AuditReportAssessmentModel, string> = {
  application: 'Applikasjonsbasert vurdering',
  repository: 'Repositorybasert vurdering',
}

export function isAuditReportAssessmentModel(value: unknown): value is AuditReportAssessmentModel {
  return value === 'application' || value === 'repository'
}
