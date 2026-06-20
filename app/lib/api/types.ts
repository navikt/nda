export interface FourEyesCoverageData {
  total: number
  approved: number
  unapproved: number
  pending: number
  coveragePercent: number
}

export interface ChangeOriginCoverageData {
  total: number
  linked: number
  dependabot: number
  coveragePercent: number
}

export interface LastDeploymentData {
  createdAt: string
  deployer: string | null
  commitSha: string | null
  fourEyesStatus: string
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

export interface AuditReportAppMetadata {
  team: string
  environment: string
  name: string
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
  periodStart: string
  periodEnd: string
  generatedAt: string
  generatedBy: string | null
  totalDeployments: number
  approvedCount: number
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
