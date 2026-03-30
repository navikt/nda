import type { AppCardData } from '~/components/AppCard'

// Base mock app data
export const mockApp: AppCardData = {
  id: 1,
  team_slug: 'pensjondeployer',
  environment_name: 'prod-fss',
  app_name: 'pensjon-pen',
  active_repo: 'navikt/pensjon-pen',
  stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
  alertCount: 0,
}

export const mockApps: AppCardData[] = [
  mockApp,
  {
    id: 2,
    team_slug: 'pensjondeployer',
    environment_name: 'prod-fss',
    app_name: 'pensjon-selvbetjening',
    active_repo: 'navikt/pensjon-selvbetjening',
    stats: { total: 15, without_four_eyes: 2, pending_verification: 0 },
    alertCount: 1,
  },
  {
    id: 3,
    team_slug: 'pensjondeployer',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-opptjening',
    active_repo: 'navikt/pensjon-opptjening',
    stats: { total: 8, without_four_eyes: 0, pending_verification: 3 },
    alertCount: 0,
  },
  {
    id: 4,
    team_slug: 'pensjonsamhandling',
    environment_name: 'prod-fss',
    app_name: 'pensjon-samhandling-api',
    active_repo: 'navikt/pensjon-samhandling-api',
    stats: { total: 23, without_four_eyes: 1, pending_verification: 0 },
    alertCount: 0,
  },
  {
    id: 5,
    team_slug: 'pensjonsamhandling',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-samhandling-frontend',
    active_repo: 'navikt/pensjon-samhandling-frontend',
    stats: { total: 12, without_four_eyes: 0, pending_verification: 1 },
    alertCount: 0,
  },
]

export const mockDeploymentStats = {
  total: 42,
  with_four_eyes: 38,
  without_four_eyes: 2,
  pending_verification: 2,
  four_eyes_percentage: 90,
  last_deployment: '2026-02-08T10:30:00Z',
  last_deployment_id: 123,
}

export const mockRepository = {
  id: 1,
  monitored_app_id: 1,
  github_owner: 'navikt',
  github_repo_name: 'pensjon-pen',
  status: 'active' as const,
  approved_by: 'admin',
  redirects_to_owner: null,
  redirects_to_repo: null,
  created_at: '2026-01-15T08:00:00Z',
  updated_at: '2026-01-15T08:00:00Z',
}

export const mockPendingRepository = {
  ...mockRepository,
  id: 2,
  github_repo_name: 'pensjon-pen-v2',
  status: 'pending_approval' as const,
}

const mockHistoricalRepository = {
  ...mockRepository,
  id: 3,
  github_repo_name: 'pensjon-pen-legacy',
  status: 'historical' as const,
  redirects_to_owner: 'navikt',
  redirects_to_repo: 'pensjon-pen',
}

export const mockAlert = {
  id: 1,
  monitored_app_id: 1,
  deployment_id: 100,
  alert_type: 'repository_mismatch' as const,
  expected_github_owner: 'navikt',
  expected_github_repo_name: 'pensjon-pen',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'pensjon-pen-fork',
  is_resolved: false,
  resolution_note: null,
  resolved_at: null,
  created_at: '2026-02-07T14:00:00Z',
}

export const mockAuditReport = {
  id: 1,
  report_id: 'RPT-2026-001',
  monitored_app_id: 1,
  year: 2026,
  total_deployments: 156,
  pr_approved_count: 145,
  manually_approved_count: 11,
  generated_at: '2026-02-01T12:00:00Z',
  generated_by: 'A123456',
  created_at: '2026-02-01T12:00:00Z',
}

const mockDeployment = {
  id: 1,
  commit_sha: 'abc123def456',
  commit_message: 'feat: Add new feature',
  commit_author: 'john-doe',
  commit_author_email: 'john.doe@nav.no',
  deployer: 'jane-smith',
  deploy_started_at: '2026-02-08T10:30:00Z',
  created_at: '2026-02-08T10:30:00Z',
  team_slug: 'pensjondeployer',
  environment_name: 'prod-fss',
  app_name: 'pensjon-pen',
  four_eyes_status: 'approved' as const,
  approval_source: 'pr_approval' as const,
  github_owner: 'navikt',
  github_repo_name: 'pensjon-pen',
}

export const mockDeployments = [
  mockDeployment,
  {
    ...mockDeployment,
    id: 2,
    commit_sha: 'def456abc789',
    commit_message: 'fix: Bug fix',
    four_eyes_status: 'direct_push' as const,
    approval_source: null,
    deploy_started_at: '2026-02-07T15:00:00Z',
    created_at: '2026-02-07T15:00:00Z',
  },
  {
    ...mockDeployment,
    id: 3,
    commit_sha: 'ghi789jkl012',
    commit_message: 'chore: Update dependencies',
    four_eyes_status: 'pending' as const,
    approval_source: null,
    deploy_started_at: '2026-02-06T09:00:00Z',
    created_at: '2026-02-06T09:00:00Z',
  },
]

export const mockUserMapping = {
  github_username: 'john-doe',
  display_name: 'John Doe',
  nav_email: 'john.doe@nav.no',
  nav_ident: 'A123456',
  slack_member_id: 'U12345678',
}

export const mockSearchResults = [
  {
    id: 1,
    type: 'deployment' as const,
    title: 'abc123def456',
    subtitle: 'pensjon-pen (prod-fss) - John Doe',
    url: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments/1',
  },
  {
    id: 2,
    type: 'user' as const,
    title: 'john-doe',
    subtitle: 'John Doe (A123456)',
    url: '/users/john-doe',
  },
]

export const mockNaisApps = [
  { teamSlug: 'pensjondeployer', appName: 'pensjon-pen', environmentName: 'prod-fss' },
  { teamSlug: 'pensjondeployer', appName: 'pensjon-selvbetjening', environmentName: 'prod-fss' },
  { teamSlug: 'pensjondeployer', appName: 'pensjon-opptjening', environmentName: 'prod-gcp' },
  { teamSlug: 'pensjonsamhandling', appName: 'pensjon-samhandling-api', environmentName: 'prod-fss' },
]

const mockSyncJobs = [
  {
    id: 1,
    app_id: 1,
    app_name: 'pensjon-pen',
    team_slug: 'pensjondeployer',
    status: 'completed' as const,
    started_at: '2026-02-08T10:00:00Z',
    completed_at: '2026-02-08T10:00:15Z',
    deployments_synced: 5,
    error_message: null,
  },
  {
    id: 2,
    app_id: 2,
    app_name: 'pensjon-selvbetjening',
    team_slug: 'pensjondeployer',
    status: 'running' as const,
    started_at: '2026-02-08T10:05:00Z',
    completed_at: null,
    deployments_synced: 0,
    error_message: null,
  },
]
