import { pool } from '~/db/connection.server'
import { LEGACY_STATUSES_SQL } from '~/lib/four-eyes-status'
import { getCommitAncestryStatus } from '~/lib/github'
import { logger } from '~/lib/logger.server'

export interface PreviousDeploymentResult {
  id: number
  commitSha: string
  createdAt: string
}

interface PreviousDeploymentCandidate {
  id: number
  commitSha: string
  createdAt: Date
}

async function queryCandidates(
  currentDeploymentId: number,
  githubRepoId: string,
  auditStartYear: number | null,
): Promise<PreviousDeploymentCandidate[]> {
  const params: (number | string)[] = [currentDeploymentId, githubRepoId]
  let query = `
    SELECT d.id, d.commit_sha, d.created_at
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    JOIN application_repositories ar ON ar.monitored_app_id = ma.id AND ar.status = 'active'
    WHERE d.created_at < (SELECT created_at FROM deployments WHERE id = $1)
      AND ar.github_repo_id = $2
      AND ma.is_active = true
      AND d.detected_github_owner = ar.github_owner
      AND d.detected_github_repo_name = ar.github_repo_name
      AND d.commit_sha IS NOT NULL
      AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
      AND d.commit_sha !~ '^refs/'
  `

  if (auditStartYear) {
    params.push(`${auditStartYear}-01-01`)
    query += ` AND d.created_at >= $${params.length}`
  }

  query += ` ORDER BY d.created_at DESC LIMIT 20`

  const result = await pool.query(query, params)
  return result.rows.map((row) => ({
    id: row.id,
    commitSha: row.commit_sha,
    createdAt: row.created_at,
  }))
}

async function findAncestorCandidate(
  candidates: PreviousDeploymentCandidate[],
  owner: string,
  repo: string,
  currentCommitSha: string,
): Promise<PreviousDeploymentResult | null> {
  if (candidates.length === 0) return null

  if (candidates.length === 1) {
    const only = candidates[0]
    return { id: only.id, commitSha: only.commitSha, createdAt: only.createdAt.toISOString() }
  }

  for (const candidate of candidates) {
    const status = await getCommitAncestryStatus(owner, repo, candidate.commitSha, currentCommitSha)

    if (status === null) {
      logger.warn(
        `⚠️ Could not verify ancestry of candidate previous deployment ${candidate.commitSha.substring(0, 7)} for ${owner}/${repo}, skipping`,
      )
      continue
    }

    if (status === 'identical' || status === 'ahead') {
      return { id: candidate.id, commitSha: candidate.commitSha, createdAt: candidate.createdAt.toISOString() }
    }

    if (status === 'diverged') {
      logger.warn(`⚠️ history_anomaly: candidate previous deployment is not an ancestor of the current commit`, {
        log_type: 'history_anomaly',
        owner,
        repo,
        candidate_commit_sha: candidate.commitSha,
        current_commit_sha: currentCommitSha,
        ancestry_status: status,
      })
    }
  }

  return null
}

export async function getPreviousDeployment(
  currentDeploymentId: number,
  owner: string,
  repo: string,
  githubRepoId: string | null,
  auditStartYear: number | null,
  currentCommitSha: string,
): Promise<PreviousDeploymentResult | null> {
  if (!githubRepoId) return null

  const candidates = await queryCandidates(currentDeploymentId, githubRepoId, auditStartYear)
  return findAncestorCandidate(candidates, owner, repo, currentCommitSha)
}
