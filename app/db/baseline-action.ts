/**
 * Canonical SQL predicate for "baseline action needed" deployments.
 *
 * Matches deployments where:
 * - four_eyes_status = 'pending_baseline' (waiting for baseline to be set), OR
 * - four_eyes_status = 'baseline' AND no attributed baseline_approval row exists
 *   in deployment_status_history (baseline was set but the approver is unknown)
 *
 * @param alias Table alias for the deployments table (e.g. 'deployments', 'd')
 */
export function baselineActionSql(alias: string): string {
  return `(
    ${alias}.four_eyes_status = 'pending_baseline'
    OR (${alias}.four_eyes_status = 'baseline' AND NOT EXISTS (
      SELECT 1 FROM deployment_status_history dsh
      WHERE dsh.deployment_id = ${alias}.id
        AND dsh.change_source = 'baseline_approval'
        AND dsh.changed_by IS NOT NULL
    ))
  )`
}
