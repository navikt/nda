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
