/**
 * API Response Types
 *
 * Types for external API responses consumed by other applications (e.g. KISS).
 * These types define the contract — changes should be backward-compatible.
 */

export interface FourEyesCoverageData {
  /** Total number of deployments in the period */
  total: number
  /** Deployments with approved four-eyes verification */
  approved: number
  /** Deployments that failed four-eyes verification */
  unapproved: number
  /** Deployments pending verification */
  pending: number
  /** Four-eyes coverage percentage (approved / total * 100) */
  coveragePercent: number
}

export interface ChangeOriginCoverageData {
  /** Total number of deployments (excluding Dependabot) */
  total: number
  /** Deployments linked to an objective or key result */
  linked: number
  /** Dependabot deployments (excluded from coverage calculation) */
  dependabot: number
  /** Change origin coverage percentage (linked / total * 100) */
  coveragePercent: number
}

export interface LastDeploymentData {
  /** When the deployment was created */
  createdAt: string
  /** GitHub username of the deployer */
  deployer: string | null
  /** Git commit SHA */
  commitSha: string | null
  /** Four-eyes verification status */
  fourEyesStatus: string
  /** Whether the deployment is linked to an objective/key result */
  hasChangeOrigin: boolean
}

export interface VerificationSummaryResponse {
  app: {
    team: string
    environment: string
    name: string
    isActive: boolean
  }
  period: {
    from: string
    to: string
  }
  fourEyesCoverage: FourEyesCoverageData
  changeOriginCoverage: ChangeOriginCoverageData
  lastDeployment: LastDeploymentData | null
}

// ─── M2M Audit Reports API ──────────────────────────────────────────────────

export interface AuditReportAppMetadata {
  team: string
  environment: string
  name: string
  /** 1 January of audit_start_year, or null if no restriction */
  auditStartDate: string | null
  applicationGroup: {
    name: string
    apps: Array<{ team: string; environment: string; name: string }>
  } | null
}

export interface AuditReportSummaryM2M {
  reportId: string
  periodType: string
  periodLabel: string
  /** ISO date (YYYY-MM-DD) */
  periodStart: string
  /** ISO date (YYYY-MM-DD), last day of the period */
  periodEnd: string
  /** ISO datetime */
  generatedAt: string
  /** NAV-ident (user) or fully qualified M2M app name, or null for legacy reports */
  generatedBy: string | null
  totalDeployments: number
  approvedCount: number
  /** Deployments with goal links (excl. Dependabot). null for older reports. */
  withChangeOriginCount: number | null
  contentHash: string
  availableFormats: string[]
}

export type ReportJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface AuditReportStatusResponse {
  app: AuditReportAppMetadata
  period: {
    type: string
    label: string
    start: string
    end: string
  }
  deployments: {
    total: number
    approved: number
    pending: number
    notApproved: number
    approvedPercent: number
    withChangeOrigin: number
    changeOriginPercent: number
  }
  existingReports: AuditReportSummaryM2M[]
  availableFormats: string[]
}

export interface AuditReportListResponse {
  app: AuditReportAppMetadata
  reports: AuditReportSummaryM2M[]
}

export interface AuditReportGenerateResponse {
  app: AuditReportAppMetadata
  jobId: string
  status: ReportJobStatus
  reportId: string | null
  message: string
}

export interface AuditReportJobStatusResponse {
  app: AuditReportAppMetadata
  jobId: string
  status: ReportJobStatus
  createdAt: string
  completedAt: string | null
  error: string | null
  reportId: string | null
  report: Omit<AuditReportSummaryM2M, 'periodType' | 'periodLabel' | 'periodStart' | 'periodEnd'> | null
}
