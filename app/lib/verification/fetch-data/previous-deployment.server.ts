import { pool } from '~/db/connection.server'
import { LEGACY_STATUSES_SQL, UNAUTHORIZED_STATUSES_SQL } from '~/lib/four-eyes-status'
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

const CANDIDATE_PAGE_SIZE = 20
const MAX_CANDIDATE_PAGES = 10

async function queryCandidates(
  currentDeploymentId: number,
  githubRepoId: string,
  auditStartYear: number | null,
  offset: number,
): Promise<PreviousDeploymentCandidate[]> {
  const params: (number | string)[] = [currentDeploymentId, githubRepoId]
  let query = `
    SELECT d.id, d.commit_sha, d.created_at
    FROM deployments d
    JOIN application_repositories ar
      ON ar.monitored_app_id = d.monitored_app_id
      AND ar.github_owner = d.detected_github_owner
      AND ar.github_repo_name = d.detected_github_repo_name
      AND ar.status IN ('active', 'historical')
    WHERE (d.created_at, d.id) < (SELECT created_at, id FROM deployments WHERE id = $1)
      AND ar.github_repo_id = $2
      AND d.commit_sha IS NOT NULL
      AND d.four_eyes_status NOT IN (${LEGACY_STATUSES_SQL})
      AND d.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
      AND d.commit_sha !~ '^refs/'
  `

  if (auditStartYear) {
    params.push(`${auditStartYear}-01-01`)
    query += ` AND d.created_at >= $${params.length}`
  }

  params.push(CANDIDATE_PAGE_SIZE)
  const limitParamIndex = params.length
  params.push(offset)
  const offsetParamIndex = params.length

  query += ` ORDER BY d.created_at DESC, d.id DESC LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`

  const result = await pool.query(query, params)
  return result.rows.map((row) => ({
    id: row.id,
    commitSha: row.commit_sha,
    createdAt: row.created_at,
  }))
}

function toSafeGithubRepoId(githubRepoId: string): number | undefined {
  try {
    const asBigInt = BigInt(githubRepoId)
    if (asBigInt < BigInt(Number.MIN_SAFE_INTEGER) || asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined
    }
    return Number(asBigInt)
  } catch {
    return undefined
  }
}

async function findAncestorCandidate(
  candidates: PreviousDeploymentCandidate[],
  owner: string,
  repo: string,
  currentCommitSha: string,
  githubRepoId: string,
): Promise<PreviousDeploymentResult | null> {
  const knownGithubRepoId = toSafeGithubRepoId(githubRepoId)
  for (const candidate of candidates) {
    const status = await getCommitAncestryStatus(owner, repo, candidate.commitSha, currentCommitSha, knownGithubRepoId)

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

  let offset = 0
  for (let page = 0; page < MAX_CANDIDATE_PAGES; page++) {
    const candidates = await queryCandidates(currentDeploymentId, githubRepoId, auditStartYear, offset)
    if (candidates.length === 0) return null

    const found = await findAncestorCandidate(candidates, owner, repo, currentCommitSha, githubRepoId)
    if (found) return found

    if (candidates.length < CANDIDATE_PAGE_SIZE) return null
    offset += CANDIDATE_PAGE_SIZE
  }

  logger.warn('getPreviousDeployment: candidate pagination limit reached without finding an ancestor', {
    log_type: 'previous_deployment_pagination_limit',
    owner,
    repo,
    githubRepoId,
    currentDeploymentId,
    maxCandidatePages: MAX_CANDIDATE_PAGES,
  })
  return null
}
