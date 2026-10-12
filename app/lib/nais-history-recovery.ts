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

export interface NaisHistoryRiskApp {
  app_id: number
  team_slug: string
  environment_name: string
  app_name: string
  initial_nais_history_synced_at: Date | null
  completed_syncs: number
  failed_since_last_completed: number
  last_completed_at: Date | null
  last_error: string | null
  id_collision: boolean
  marker_without_completed_job: boolean
  deployment_count: number
}

export interface NaisHistoryAssessment {
  app: NaisHistoryRiskApp
  needsResync: string[]
  needsInvestigation: string[]
}

function assessNaisHistory(app: NaisHistoryRiskApp): NaisHistoryAssessment {
  const needsResync: string[] = []
  const needsInvestigation: string[] = []
  if (app.marker_without_completed_job) needsResync.push('Markør satt uten fullført synkjobb')
  if (app.failed_since_last_completed > 0 && !app.id_collision)
    needsResync.push('Synk har feilet siden siste fullførte')
  if (!app.initial_nais_history_synced_at) needsResync.push('Venter på full historikksynk')
  if (app.id_collision) needsInvestigation.push('Kollisjon på deployment-ID mellom applikasjoner')
  if (app.deployment_count === 0) needsInvestigation.push('Ingen leveranser lagret')
  return { app, needsResync, needsInvestigation }
}

export function partitionNaisHistoryRisks(apps: NaisHistoryRiskApp[]): {
  resync: NaisHistoryAssessment[]
  investigate: NaisHistoryAssessment[]
} {
  const assessments = apps.map(assessNaisHistory)
  return {
    investigate: assessments.filter((a) => a.needsInvestigation.length > 0),
    resync: assessments.filter((a) => a.needsInvestigation.length === 0 && a.needsResync.length > 0),
  }
}
