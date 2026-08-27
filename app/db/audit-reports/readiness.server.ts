import { isApprovedStatus } from '~/lib/four-eyes-status'
import { MANUAL_TRIGGER_EVENTS } from '~/lib/workflow-trigger-label'
import { AUDIT_START_YEAR_FILTER } from '../audit-start-year'
import { pool } from '../connection.server'
import { findDeploymentIdsMissingApprover } from '../verification-diff.server'

export interface AuditReadinessCheck {
  is_ready: boolean
  total_deployments: number
  approved_count: number
  legacy_count: number
  pending_count: number
  pending_deployments: Array<{
    id: number
    created_at: Date
    commit_sha: string | null
    deployer_username: string | null
    four_eyes_status: string
  }>
  missing_approver_count: number
  missing_approver_deployments: Array<{
    id: number
    created_at: Date
    commit_sha: string | null
    deployer_username: string | null
    four_eyes_status: string
  }>
  manual_trigger_count: number
  manual_trigger_deployments: Array<{
    id: number
    created_at: Date
    commit_sha: string | null
    deployer_username: string | null
    four_eyes_status: string
    trigger_event: string
  }>
}

export async function checkAuditReadiness(
  monitoredAppId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<AuditReadinessCheck> {
  const startDate = periodStart
  const endDate = periodEnd

  const result = await pool.query<{
    id: number
    created_at: Date
    commit_sha: string | null
    deployer_username: string | null
    four_eyes_status: string
    environment_name: string
    trigger_event: string | null
  }>(
    `SELECT d.id, d.created_at, d.commit_sha, d.deployer_username, d.four_eyes_status, ma.environment_name,
            d.workflow_trigger_config ->> 'triggerEvent' AS trigger_event
     FROM deployments d
     JOIN monitored_applications ma ON d.monitored_app_id = ma.id
     WHERE d.monitored_app_id = $1
       AND d.created_at >= $2
       AND d.created_at <= $3
       AND ma.environment_name IN ('prod-fss', 'prod-gcp')
       AND ${AUDIT_START_YEAR_FILTER}
     ORDER BY d.created_at ASC`,
    [monitoredAppId, startDate, endDate],
  )

  const deployments = result.rows

  const approved = deployments.filter((d) => isApprovedStatus(d.four_eyes_status))
  const legacy = deployments.filter((d) => d.four_eyes_status === 'legacy')
  const pending = deployments.filter((d) => !isApprovedStatus(d.four_eyes_status) && d.four_eyes_status !== 'legacy')
  const manualTrigger = deployments.filter((d) => d.trigger_event && MANUAL_TRIGGER_EVENTS.includes(d.trigger_event))

  const approvedIds = approved.map((d) => d.id)
  let missingApprover: typeof approved = []

  if (approvedIds.length > 0) {
    const missingIds = await findDeploymentIdsMissingApprover(approvedIds)
    missingApprover = approved.filter((d) => missingIds.has(d.id))
  }

  return {
    is_ready:
      pending.length === 0 && missingApprover.length === 0 && manualTrigger.length === 0 && deployments.length > 0,
    total_deployments: deployments.length,
    approved_count: approved.length,
    legacy_count: legacy.length,
    pending_count: pending.length,
    pending_deployments: pending.slice(0, 10),
    missing_approver_count: missingApprover.length,
    missing_approver_deployments: missingApprover.slice(0, 10),
    manual_trigger_count: manualTrigger.length,
    manual_trigger_deployments: manualTrigger.slice(0, 10).map((d) => ({
      id: d.id,
      created_at: d.created_at,
      commit_sha: d.commit_sha,
      deployer_username: d.deployer_username,
      four_eyes_status: d.four_eyes_status,
      trigger_event: d.trigger_event ?? 'unknown',
    })),
  }
}
