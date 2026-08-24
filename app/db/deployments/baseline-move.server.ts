import { BASELINE_ANCHOR_STATUSES, isLegacyStatus } from '~/lib/four-eyes-status'
import { pool } from '../connection.server'

interface BaselineMoveAnchor {
  id: number
  created_at: string
  four_eyes_status: string
}

interface BaselineMoveContext {
  eligible: boolean
  anchors: BaselineMoveAnchor[]
}

type MoveBaselineFailureReason =
  | 'not_found'
  | 'already_baseline'
  | 'legacy_status'
  | 'missing_repository'
  | 'invalid_commit_sha'
  | 'outside_audit_window'
  | 'no_later_anchor'

type MoveBaselineResult = { moved: true; demotedCount: number } | { moved: false; reason: MoveBaselineFailureReason }

function isEligibleTarget(row: {
  four_eyes_status: string | null
  commit_sha: string | null
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  within_audit_window: boolean
}): MoveBaselineFailureReason | null {
  const status = row.four_eyes_status ?? ''
  if (status === 'baseline') return 'already_baseline'
  if (isLegacyStatus(status)) return 'legacy_status'
  if (!row.detected_github_owner || !row.detected_github_repo_name) return 'missing_repository'
  if (!row.commit_sha || row.commit_sha.startsWith('refs/')) return 'invalid_commit_sha'
  if (!row.within_audit_window) return 'outside_audit_window'
  return null
}

export async function getBaselineMoveContext(deploymentId: number): Promise<BaselineMoveContext | null> {
  const { rows } = await pool.query(
    `SELECT
       d.four_eyes_status,
       d.commit_sha,
       d.detected_github_owner,
       d.detected_github_repo_name,
       (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1)) AS within_audit_window,
       COALESCE(
         (SELECT json_agg(
                   json_build_object('id', a.id, 'created_at', a.created_at, 'four_eyes_status', a.four_eyes_status)
                   ORDER BY a.created_at)
          FROM deployments a
          WHERE a.monitored_app_id = d.monitored_app_id
            AND a.detected_github_owner = d.detected_github_owner
            AND a.detected_github_repo_name = d.detected_github_repo_name
            AND a.created_at > d.created_at
            AND a.four_eyes_status = ANY($2)),
         '[]'::json) AS anchors
     FROM deployments d
     JOIN monitored_applications ma ON ma.id = d.monitored_app_id
     WHERE d.id = $1`,
    [deploymentId, BASELINE_ANCHOR_STATUSES],
  )
  if (rows.length === 0) return null

  const row = rows[0]
  const anchors: BaselineMoveAnchor[] = row.anchors
  const eligible = isEligibleTarget(row) === null && anchors.length > 0
  return { eligible, anchors }
}

export async function moveBaselineToDeployment(
  deploymentId: number,
  changedBy: string,
  reason: string,
): Promise<MoveBaselineResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const targetResult = await client.query(
      `SELECT
         d.four_eyes_status,
         d.commit_sha,
         d.created_at,
         d.monitored_app_id,
         d.detected_github_owner,
         d.detected_github_repo_name,
         (ma.audit_start_year IS NULL OR d.created_at >= make_date(ma.audit_start_year, 1, 1)) AS within_audit_window
       FROM deployments d
       JOIN monitored_applications ma ON ma.id = d.monitored_app_id
       WHERE d.id = $1
       FOR UPDATE OF d`,
      [deploymentId],
    )
    if (targetResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return { moved: false, reason: 'not_found' }
    }

    const target = targetResult.rows[0]
    const ineligibleReason = isEligibleTarget(target)
    if (ineligibleReason) {
      await client.query('ROLLBACK')
      return { moved: false, reason: ineligibleReason }
    }

    const anchorsResult = await client.query<{ id: number; four_eyes_status: string }>(
      `SELECT id, four_eyes_status
       FROM deployments
       WHERE monitored_app_id = $1
         AND detected_github_owner = $2
         AND detected_github_repo_name = $3
         AND created_at > $4
         AND four_eyes_status = ANY($5)
       ORDER BY created_at
       FOR UPDATE`,
      [
        target.monitored_app_id,
        target.detected_github_owner,
        target.detected_github_repo_name,
        target.created_at,
        BASELINE_ANCHOR_STATUSES,
      ],
    )
    if (anchorsResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return { moved: false, reason: 'no_later_anchor' }
    }

    await client.query(
      `UPDATE deployments
       SET four_eyes_status = 'baseline',
           github_pr_number = NULL,
           github_pr_url = NULL,
           github_pr_data = NULL
       WHERE id = $1`,
      [deploymentId],
    )

    const details = JSON.stringify({
      reason,
      demoted_deployment_ids: anchorsResult.rows.map((a) => a.id),
    })
    const approvalResult = await client.query(
      `INSERT INTO deployment_status_history
         (deployment_id, from_status, to_status, changed_by, change_source, details)
       VALUES ($1, $2, 'baseline', $3, 'baseline_approval', $4)
       ON CONFLICT (deployment_id) WHERE change_source = 'baseline_approval' AND changed_by IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [deploymentId, target.four_eyes_status, changedBy, details],
    )
    if (approvalResult.rows.length === 0) {
      await client.query(
        `INSERT INTO deployment_status_history
           (deployment_id, from_status, to_status, changed_by, change_source, details)
         VALUES ($1, $2, 'baseline', $3, 'baseline_move', $4)`,
        [deploymentId, target.four_eyes_status, changedBy, details],
      )
    }

    for (const anchor of anchorsResult.rows) {
      await client.query(`UPDATE deployments SET four_eyes_status = 'pending' WHERE id = $1`, [anchor.id])
      await client.query(
        `INSERT INTO deployment_status_history
           (deployment_id, from_status, to_status, changed_by, change_source, details)
         VALUES ($1, $2, 'pending', $3, 'baseline_move', $4)`,
        [
          anchor.id,
          anchor.four_eyes_status,
          changedBy,
          JSON.stringify({ reason, new_baseline_deployment_id: deploymentId }),
        ],
      )
    }

    await client.query('COMMIT')
    return { moved: true, demotedCount: anchorsResult.rows.length }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
