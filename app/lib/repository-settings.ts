import type { ImplicitApprovalMode, ImplicitApprovalSettings } from './verification/types'

export interface RepositoryLevelSettings {
  repositoryId: number
  auditStartYear: number | null
  implicitApprovalMode: ImplicitApprovalMode
  defaultBranch: string | null
}

export interface AppLevelSettings {
  auditStartYear: number | null
  implicitApprovalMode: ImplicitApprovalMode
  defaultBranch: string | null
}

export interface EffectiveRepositorySettings {
  repositoryId: number | null
  auditStartYear: number | null
  implicitApprovalSettings: ImplicitApprovalSettings
  defaultBranch: string | null
}

export function resolveEffectiveSettings(
  repository: RepositoryLevelSettings | null,
  app: AppLevelSettings,
): EffectiveRepositorySettings {
  if (!repository) {
    return {
      repositoryId: null,
      auditStartYear: app.auditStartYear,
      implicitApprovalSettings: { mode: app.implicitApprovalMode },
      defaultBranch: app.defaultBranch,
    }
  }

  return {
    repositoryId: repository.repositoryId,
    auditStartYear: repository.auditStartYear,
    implicitApprovalSettings: { mode: repository.implicitApprovalMode },
    defaultBranch: repository.defaultBranch ?? app.defaultBranch,
  }
}
