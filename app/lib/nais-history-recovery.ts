export interface NaisHistoryRecoveryCandidate {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  initial_nais_history_synced_at: Date
  latest_sync_status: string | null
  latest_sync_started_at: Date | null
  latest_sync_version: string | null
  latest_sync_is_active: boolean
}
