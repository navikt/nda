import { query } from './connection.server'

interface DeploymentComment {
  id: number
  deployment_id: number
  comment_text: string
  slack_link: string | null
  comment_type: 'comment' | 'slack_link' | 'manual_approval' | 'legacy_info'
  approved_by: string | null
  approved_at: Date | null
  registered_by: string | null
  created_at: Date
}

interface CreateCommentParams {
  deployment_id: number
  comment_text: string
  slack_link?: string
  comment_type?: 'comment' | 'slack_link' | 'manual_approval' | 'legacy_info'
  approved_by?: string
  registered_by?: string
}

export async function getCommentsByDeploymentId(deployment_id: number): Promise<DeploymentComment[]> {
  const result = await query<DeploymentComment>(
    'SELECT * FROM deployment_comments WHERE deployment_id = $1 ORDER BY created_at DESC',
    [deployment_id],
  )
  return result.rows
}

export async function createComment(params: CreateCommentParams): Promise<DeploymentComment> {
  const commentType = params.comment_type || 'comment'
  const approvedAt = commentType === 'manual_approval' ? new Date() : null

  const result = await query<DeploymentComment>(
    `INSERT INTO deployment_comments (deployment_id, comment_text, slack_link, comment_type, approved_by, approved_at, registered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.deployment_id,
      params.comment_text,
      params.slack_link || null,
      commentType,
      params.approved_by || null,
      approvedAt,
      params.registered_by || null,
    ],
  )
  return result.rows[0]
}

export async function getManualApproval(deployment_id: number): Promise<DeploymentComment | null> {
  const result = await query<DeploymentComment>(
    `SELECT * FROM deployment_comments 
     WHERE deployment_id = $1 AND comment_type = 'manual_approval'
     ORDER BY created_at DESC
     LIMIT 1`,
    [deployment_id],
  )
  return result.rows[0] || null
}

export async function getLegacyInfo(deployment_id: number): Promise<DeploymentComment | null> {
  const result = await query<DeploymentComment>(
    `SELECT * FROM deployment_comments 
     WHERE deployment_id = $1 AND comment_type = 'legacy_info'
     ORDER BY created_at DESC
     LIMIT 1`,
    [deployment_id],
  )
  return result.rows[0] || null
}

export async function deleteComment(id: number): Promise<boolean> {
  const result = await query('DELETE FROM deployment_comments WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

export async function deleteLegacyInfo(deployment_id: number): Promise<boolean> {
  const result = await query(
    "DELETE FROM deployment_comments WHERE deployment_id = $1 AND comment_type = 'legacy_info'",
    [deployment_id],
  )
  return (result.rowCount ?? 0) > 0
}
