import { PENDING_STATUSES } from '~/lib/four-eyes-status'
import { pool } from '../connection.server'
import type { Deployment, GitHubPRData, UnverifiedCommit } from '../deployments.server'
import { logStatusTransition } from './status-history.server'

export async function getVerificationStats(monitoredAppId?: number): Promise<{
  total: number
  needsVerification: number
  pending: number
  error: number
}> {
  let sql = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN four_eyes_status = ANY($1) THEN 1 END) as pending,
      COUNT(CASE WHEN four_eyes_status = 'error' THEN 1 END) as error
    FROM deployments
  `

  const params: any[] = [PENDING_STATUSES]
  if (monitoredAppId) {
    sql += ' WHERE monitored_app_id = $2'
    params.push(monitoredAppId)
  }

  const result = await pool.query(sql, params)
  const pending = parseInt(result.rows[0].pending, 10)
  const error = parseInt(result.rows[0].error, 10)

  return {
    total: parseInt(result.rows[0].total, 10),
    needsVerification: pending + error,
    pending,
    error,
  }
}

export async function updateDeploymentFourEyes(
  deploymentId: number,
  data: {
    fourEyesStatus: string
    githubPrNumber: number | null
    githubPrUrl: string | null
    githubPrData?: GitHubPRData | null
    branchName?: string | null
    parentCommits?: Array<{ sha: string }> | null
    unverifiedCommits?: UnverifiedCommit[] | null
    title?: string | null
  },
  statusChangeOptions?: {
    changeSource: string
    changedBy?: string
    details?: Record<string, unknown>
  },
): Promise<Deployment> {
  const current = await pool.query(`SELECT four_eyes_status FROM deployments WHERE id = $1`, [deploymentId])

  const result = await pool.query(
    `UPDATE deployments 
     SET four_eyes_status = $1,
         github_pr_number = $2,
         github_pr_url = $3,
         github_pr_data = $4,
         branch_name = $5,
         parent_commits = $6,
         unverified_commits = $7,
         title = $8
     WHERE id = $9
     RETURNING *`,
    [
      data.fourEyesStatus,
      data.githubPrNumber,
      data.githubPrUrl,
      data.githubPrData ? JSON.stringify(data.githubPrData) : null,
      data.branchName || null,
      data.parentCommits ? JSON.stringify(data.parentCommits) : null,
      data.unverifiedCommits ? JSON.stringify(data.unverifiedCommits) : null,
      data.title || null,
      deploymentId,
    ],
  )

  if (result.rows.length === 0) {
    throw new Error('Deployment not found')
  }

  if (current.rows.length > 0) {
    const prev = current.rows[0]
    if (prev.four_eyes_status !== data.fourEyesStatus) {
      const source = statusChangeOptions?.changeSource || 'unknown'
      await logStatusTransition(deploymentId, {
        fromStatus: prev.four_eyes_status,
        toStatus: data.fourEyesStatus,
        changeSource: source,
        changedBy: statusChangeOptions?.changedBy,
        details: statusChangeOptions?.details,
      })
    }
  }

  return result.rows[0]
}

export async function updateDeploymentLegacyData(
  deploymentId: number,
  data: {
    commitSha: string | null
    commitMessage: string | null
    deployer: string | null
    mergedBy: string | null
    prNumber: number | null
    prUrl: string | null
    prTitle: string | null
    prAuthor: string | null
    prMergedAt: string | null
    reviewers: Array<{ username: string; state: string }>
  },
): Promise<Deployment> {
  const effectiveDeployer = data.mergedBy || data.deployer

  let githubPrDataStr: string | null = null
  if (data.prNumber || data.reviewers.length > 0) {
    const prData = {
      title: data.prTitle || data.commitMessage || '',
      number: data.prNumber,
      html_url: data.prUrl,
      user: data.prAuthor ? { login: data.prAuthor } : null,
      merged_by: data.mergedBy ? { login: data.mergedBy } : null,
      merged_at: data.prMergedAt,
      reviewers: data.reviewers.map((r) => ({
        username: r.username,
        avatar_url: '',
        state: r.state,
        submitted_at: new Date().toISOString(),
      })),
      _legacy_verified: true,
    }
    githubPrDataStr = JSON.stringify(prData)
  }

  const result = await pool.query(
    `UPDATE deployments 
     SET commit_sha = COALESCE($1, commit_sha),
         deployer_username = COALESCE($2, deployer_username),
         github_pr_number = $3,
         github_pr_url = $4,
         github_pr_data = COALESCE($5::jsonb, github_pr_data),
         title = COALESCE($6, title)
     WHERE id = $7
     RETURNING *`,
    [
      data.commitSha,
      effectiveDeployer,
      data.prNumber,
      data.prUrl,
      githubPrDataStr,
      data.prTitle || data.commitMessage,
      deploymentId,
    ],
  )

  if (result.rows.length === 0) {
    throw new Error('Deployment not found')
  }

  return result.rows[0]
}
