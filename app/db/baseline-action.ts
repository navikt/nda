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
