export const SYNC_JOB_TYPES = [
  'nais_sync',
  'github_verify',
  'fetch_verification_data',
  'reverify_app',
  'reverify_all',
  'cache_check_logs',
] as const
export type SyncJobType = (typeof SYNC_JOB_TYPES)[number]

export const SYNC_JOB_TYPE_LABELS: Record<SyncJobType, string> = {
  nais_sync: 'NAIS Sync',
  github_verify: 'GitHub Verifisering',
  fetch_verification_data: 'Hent verifiseringsdata',
  reverify_app: 'Reverifisering',
  reverify_all: 'Reverifisering (alle apper)',
  cache_check_logs: 'Cache sjekk-logger',
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
