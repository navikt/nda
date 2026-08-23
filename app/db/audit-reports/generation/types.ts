export interface AuditDeploymentRow {
  id: number
  nais_deployment_id: string
  title: string | null
  created_at: Date
  commit_sha: string | null
  deployer_username: string | null
  four_eyes_status: string
  github_pr_number: number | null
  github_pr_url: string | null
  detected_github_owner: string
  detected_github_repo_name: string
  team_slug: string
  environment_name: string
  app_name: string
  approved_by_usernames: string[] | null
  pr_author: string | null
  unverified_commits: UnverifiedCommitEntry[] | null
  delivery_commit_shas: string[] | null
  pr_commit_shas: string[] | null
}

export interface AdminResetEntry {
  deployment_id: number
  reset_at: string
  reset_by: string
  reason: string
}

export interface AuditReportData {
  deployments: AuditDeploymentEntry[]
  manual_approvals: ManualApprovalEntry[]
  contributors: ContributorEntry[]
  reviewers: ReviewerEntry[]
  legacy_count: number
  baseline_count?: number
  deviations: DeviationEntry[]
  unverified_commit_deployments: UnverifiedCommitDeploymentEntry[]
  show_unverified_commits_note: boolean
  admin_resets: AdminResetEntry[]
}

export interface DeviationEntry {
  deployment_id: number
  date: string
  commit_sha: string
  reason: string
  breach_type: string | null
  intent: string | null
  severity: string | null
  follow_up_role: string | null
  registered_by: string
  registered_by_name: string | null
  resolved_at: string | null
  resolution_note: string | null
}

export interface AuditGoalLinkEntry {
  objective_title: string
  key_result_title: string | null
  team_name: string
  period_label: string
}

export interface AuditDeploymentEntry {
  id: number
  nais_deployment_id: string
  title: string
  date: string
  commit_sha: string
  method: 'pr' | 'manual' | 'legacy' | 'baseline'
  pr_author?: string
  pr_author_display_name?: string
  deployer: string
  deployer_display_name?: string
  approver: string
  approver_display_name?: string
  pr_number?: number
  pr_url?: string
  slack_link?: string
  goal_links?: AuditGoalLinkEntry[]
  delivery_commit_count?: number
}

export interface ManualApprovalEntry {
  deployment_id: number
  nais_deployment_id: string
  title: string
  date: string
  commit_sha: string
  deployer: string
  deployer_display_name?: string
  reason: string
  registered_by: string
  registered_by_display_name?: string
  approved_by: string
  approved_by_display_name?: string
  approved_at: string
  slack_link: string
  comment: string
}

export interface ContributorEntry {
  github_username: string
  display_name: string | null
  nav_ident: string | null
  deployment_count: number
}

export interface ReviewerEntry {
  github_username: string
  display_name: string | null
  review_count: number
}

export interface UnverifiedCommitEntry {
  sha: string
  message: string
  author: string
  date: string
  html_url: string
  pr_number: number | null
  reason: string
}

export interface UnverifiedCommitDeploymentEntry {
  deployment_id: number
  date: string
  commit_sha: string
  title: string
  deployer: string
  deployer_display_name?: string
  four_eyes_status: string
  approved_by?: string
  approved_by_display_name?: string
  approved_at?: string
  commits: UnverifiedCommitEntry[]
}
