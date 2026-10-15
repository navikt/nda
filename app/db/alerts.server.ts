import { pool } from './connection.server'

export type RepositoryAlertType = 'repository_mismatch' | 'pending_approval' | 'historical_repository'

interface RepositoryAlert {
  id: number
  monitored_app_id: number
  deployment_id: number
  alert_type: RepositoryAlertType
  expected_github_owner: string
  expected_github_repo_name: string
  detected_github_owner: string
  detected_github_repo_name: string
  resolved: boolean
  resolved_at: Date | null
  resolved_by: string | null
  resolution_note: string | null
  created_at: Date
}

interface RepositoryAlertWithContext extends RepositoryAlert {
  team_slug: string
  environment_name: string
  app_name: string
  deployment_nais_id: string | null
  deployment_source: 'nais_deployment' | 'nais_apply'
  deployment_source_id: string | null
  deployment_created_at: Date
  deployer_username: string
  commit_sha: string
}

export async function createRepositoryAlert(data: {
  monitoredApplicationId: number
  deploymentNaisId: string
  detectedGithubOwner: string
  detectedGithubRepoName: string
  expectedGithubOwner?: string
  expectedGithubRepoName?: string
  alertType: RepositoryAlertType
}): Promise<boolean> {
  const depResult = await pool.query(
    'SELECT id FROM deployments WHERE nais_deployment_id = $1 AND monitored_app_id = $2',
    [data.deploymentNaisId, data.monitoredApplicationId],
  )

  if (depResult.rows.length === 0) {
    throw new Error(
      `Deployment not found with nais_deployment_id ${data.deploymentNaisId} for monitored application ${data.monitoredApplicationId}`,
    )
  }

  return createRepositoryAlertForDeployment({
    monitoredApplicationId: data.monitoredApplicationId,
    deploymentId: depResult.rows[0].id,
    detectedGithubOwner: data.detectedGithubOwner,
    detectedGithubRepoName: data.detectedGithubRepoName,
    expectedGithubOwner: data.expectedGithubOwner,
    expectedGithubRepoName: data.expectedGithubRepoName,
    alertType: data.alertType,
  })
}

export async function createRepositoryAlertForDeployment(data: {
  monitoredApplicationId: number
  deploymentId: number
  detectedGithubOwner: string
  detectedGithubRepoName: string
  expectedGithubOwner?: string
  expectedGithubRepoName?: string
  alertType: RepositoryAlertType
}): Promise<boolean> {
  const expectedOwner = data.expectedGithubOwner || data.detectedGithubOwner
  const expectedRepoName = data.expectedGithubRepoName || data.detectedGithubRepoName

  const result = await pool.query(
    `WITH alert_event AS (
      SELECT
        $1::integer AS monitored_app_id,
        $2::integer AS deployment_id,
        $3::varchar AS alert_type,
        $4::varchar AS expected_github_owner,
        $5::varchar AS expected_github_repo_name,
        $6::varchar AS detected_github_owner,
        $7::varchar AS detected_github_repo_name
    )
    INSERT INTO repository_alerts
      (monitored_app_id, deployment_id, alert_type, expected_github_owner, expected_github_repo_name, detected_github_owner, detected_github_repo_name, idempotency_key_enabled)
    SELECT
      input_values.monitored_app_id,
      input_values.deployment_id,
      input_values.alert_type,
      input_values.expected_github_owner,
      input_values.expected_github_repo_name,
      input_values.detected_github_owner,
      input_values.detected_github_repo_name,
      TRUE
    FROM alert_event input_values
    WHERE NOT EXISTS (
      SELECT 1
      FROM repository_alerts existing
      WHERE existing.deployment_id = input_values.deployment_id
        AND existing.alert_type = input_values.alert_type
        AND existing.expected_github_owner = input_values.expected_github_owner
        AND existing.expected_github_repo_name = input_values.expected_github_repo_name
        AND existing.detected_github_owner = input_values.detected_github_owner
        AND existing.detected_github_repo_name = input_values.detected_github_repo_name
    )
    ON CONFLICT DO NOTHING
    RETURNING id`,
    [
      data.monitoredApplicationId,
      data.deploymentId,
      data.alertType,
      expectedOwner,
      expectedRepoName,
      data.detectedGithubOwner,
      data.detectedGithubRepoName,
    ],
  )
  return result.rowCount === 1
}

export async function resolveRepositoryAlert(id: number, resolutionNote: string): Promise<RepositoryAlert> {
  const result = await pool.query(
    `UPDATE repository_alerts 
    SET resolved = true, resolved_at = CURRENT_TIMESTAMP, resolved_by = 'web-user', resolution_note = $2
    WHERE id = $1
    RETURNING *`,
    [id, resolutionNote],
  )

  if (result.rows.length === 0) {
    throw new Error('Alert not found')
  }

  return result.rows[0]
}

export async function getAlertCountsByApp(): Promise<Map<number, number>> {
  const result = await pool.query(`
    SELECT ra.monitored_app_id, COUNT(*) as count
    FROM repository_alerts ra
    LEFT JOIN deployments d ON d.id = ra.deployment_id
    JOIN monitored_applications ma ON ma.id = ra.monitored_app_id
    WHERE ra.resolved_at IS NULL
      AND (d.id IS NULL OR d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)
    GROUP BY ra.monitored_app_id
  `)
  const map = new Map<number, number>()
  for (const row of result.rows) {
    map.set(row.monitored_app_id, parseInt(row.count, 10))
  }
  return map
}

export async function getUnresolvedAlertsByApp(monitoredAppId: number): Promise<RepositoryAlertWithContext[]> {
  const result = await pool.query(
    `SELECT 
      ra.*,
      ma.team_slug,
      ma.environment_name,
      ma.app_name,
      d.nais_deployment_id as deployment_nais_id,
      d.deployment_source,
      d.deployment_source_id,
      d.created_at as deployment_created_at,
      d.deployer_username,
      d.commit_sha
    FROM repository_alerts ra
    JOIN monitored_applications ma ON ra.monitored_app_id = ma.id
    JOIN deployments d ON ra.deployment_id = d.id
    WHERE ra.resolved_at IS NULL
      AND ra.monitored_app_id = $1
      AND (d.deployment_source != 'nais_apply' OR ma.nais_apply_enabled = true)
    ORDER BY ra.created_at DESC`,
    [monitoredAppId],
  )
  return result.rows
}
