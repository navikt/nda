import { pool } from '~/db/connection.server'
import { LEGACY_STATUSES_SQL } from '~/lib/four-eyes-status'

export async function getPreviousDeployment(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  environmentName: string,
  auditStartYear: number | null,
  monitoredAppId: number,
): Promise<{ id: number; commitSha: string; createdAt: string } | null> {
  let query = `
    SELECT d.id, d.commit_sha, d.created_at
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.created_at < (SELECT created_at FROM deployments WHERE id = $1)
      AND d.monitored_app_id = $2
      AND ma.environment_name = $3
      AND d.detected_github_owner = $4
      AND d.detected_github_repo_name = $5
      AND d.commit_sha IS NOT NULL
      AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
      AND d.commit_sha !~ '^refs/'
  `
  const params: (number | string)[] = [currentDeploymentId, monitoredAppId, environmentName, owner, repo]

  if (auditStartYear) {
    query += ` AND d.created_at >= $6`
    params.push(`${auditStartYear}-01-01`)
  }

  query += ` ORDER BY d.created_at DESC LIMIT 1`

  const result = await pool.query(query, params)

  if (result.rows.length > 0) {
    return {
      id: result.rows[0].id,
      commitSha: result.rows[0].commit_sha,
      createdAt: result.rows[0].created_at.toISOString(),
    }
  }

  return getPreviousDeploymentFromGroupSibling(currentDeploymentId, owner, repo, auditStartYear, monitoredAppId)
}

async function getPreviousDeploymentFromGroupSibling(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  auditStartYear: number | null,
  monitoredAppId: number,
): Promise<{ id: number; commitSha: string; createdAt: string } | null> {
  const groupCheck = await pool.query<{ application_group_id: number | null }>(
    `SELECT application_group_id FROM monitored_applications WHERE id = $1`,
    [monitoredAppId],
  )
  const groupId = groupCheck.rows[0]?.application_group_id
  if (!groupId) return null

  let query = `
    SELECT d.id, d.commit_sha, d.created_at
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    WHERE d.created_at < (SELECT created_at FROM deployments WHERE id = $1)
      AND d.detected_github_owner = $2
      AND d.detected_github_repo_name = $3
      AND d.commit_sha IS NOT NULL
      AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
      AND d.commit_sha !~ '^refs/'
      AND ma.application_group_id = $4
  `
  const params: (number | string)[] = [currentDeploymentId, owner, repo, groupId]

  if (auditStartYear) {
    query += ` AND d.created_at >= $5`
    params.push(`${auditStartYear}-01-01`)
  }

  query += ` ORDER BY d.created_at DESC LIMIT 1`

  const result = await pool.query(query, params)

  if (result.rows.length === 0) {
    return null
  }

  return {
    id: result.rows[0].id,
    commitSha: result.rows[0].commit_sha,
    createdAt: result.rows[0].created_at.toISOString(),
  }
}
