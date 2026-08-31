export const SYNC_JOB_TYPES = [
  'nais_sync',
  'github_verify',
  'fetch_verification_data',
  'reverify_app',
  'reverify_all',
  'cache_check_logs',
  'refresh_missing_approver',
  'backfill_workflow_triggers',
  'checks_reverify',
  'backfill_github_repo_ids',
] as const
export type SyncJobType = (typeof SYNC_JOB_TYPES)[number]

export const SYNC_JOB_TYPE_LABELS: Record<SyncJobType, string> = {
  nais_sync: 'NAIS Sync',
  github_verify: 'GitHub Verifisering',
  fetch_verification_data: 'Hent verifiseringsdata',
  reverify_app: 'Reverifisering',
  reverify_all: 'Reverifisering (alle apper)',
  cache_check_logs: 'Cache sjekk-logger',
  refresh_missing_approver: 'Oppdater manglende godkjenner',
  backfill_workflow_triggers: 'Hent workflow-trigger (alle apper)',
  checks_reverify: 'Reverifiser ventende checks',
  backfill_github_repo_ids: 'Hent GitHub repo-ID (alle repoer)',
}

export const SYNC_JOB_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number]

export const SYNC_JOB_STATUS_LABELS: Record<SyncJobStatus, string> = {
  pending: 'Venter',
  running: 'Kjører',
  completed: 'Fullført',
  failed: 'Feilet',
  cancelled: 'Avbrutt',
}

export interface SyncJob {
  id: number
  job_type: SyncJobType
  monitored_app_id: number | null
  status: SyncJobStatus
  started_at: string | null
  completed_at: string | null
  locked_by: string | null
  lock_expires_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  options: Record<string, unknown> | null
  created_at: string
}

export interface SyncJobWithApp extends SyncJob {
  app_name: string | null
  team_slug: string | null
  environment_name: string | null
}

export interface SyncJobLog {
  id: number
  job_id: number
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  details: Record<string, unknown> | null
  created_at: string
}
