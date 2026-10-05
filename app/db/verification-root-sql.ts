export function recordedComparisonRangeSql(deploymentAlias: string): string {
  return `(
    SELECT latest.result->'comparisonRange' AS comparison_range
    FROM (
      SELECT vr.result, vr.status
      FROM verification_runs vr
      WHERE vr.deployment_id = ${deploymentAlias}.id
      ORDER BY vr.run_at DESC, vr.id DESC
      LIMIT 1
    ) latest
    WHERE latest.status = ${deploymentAlias}.four_eyes_status
      AND jsonb_typeof(latest.result->'comparisonRange'->'headSha') = 'string'
      AND latest.result->'comparisonRange'->>'headSha' = ${deploymentAlias}.commit_sha
      AND jsonb_typeof(latest.result->'comparisonRange'->'baseSha') IN ('string', 'null')
      AND (latest.result->'comparisonRange'->'baseSha' = 'null'::jsonb
           OR length(latest.result->'comparisonRange'->>'baseSha') > 0)
  )`
}

export function canShareApprovalSql(deploymentAlias: string): string {
  return `(
    ${deploymentAlias}.four_eyes_status != 'no_changes'
    OR COALESCE((
      SELECT vr.status = ${deploymentAlias}.four_eyes_status
        AND vr.result->'isSameAppRedeploy' = 'false'::jsonb
      FROM verification_runs vr
      WHERE vr.deployment_id = ${deploymentAlias}.id
      ORDER BY vr.run_at DESC, vr.id DESC
      LIMIT 1
    ), false)
  )`
}
