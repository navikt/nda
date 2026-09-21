import { pool } from '~/db/connection.server'
import {
  NON_DIFFABLE_STATUSES_SQL,
  ROOT_APPROVED_STATUSES_SQL,
  UNAUTHORIZED_STATUSES_SQL,
} from '~/lib/four-eyes-status'
import { getCommitAncestryStatus, getGitHubRateLimitRemaining } from '~/lib/github'
import { logger } from '~/lib/logger.server'

export interface RootApprovedSibling {
  id: number
  monitoredAppId: number
  fourEyesStatus: string
}

// Finds the earliest deployment in this repo that itself holds a root-approved status
// (not verified_via_sibling) for the same commit. This may belong to ANY app sharing the
// repo — including the app currently being verified, e.g. when that app deployed and had
// this exact commit approved earlier, and a sibling app has since re-deployed the same
// commit (making the sibling the nearest previousDeployment candidate even though the
// current app's own earlier deployment is the true, more relevant root). Bounded to one
// repo's apps, so this is a cheap single-hop lookup rather than a chain walk.
// beforeDeploymentId excludes candidates created after the deployment currently being verified,
// so a later deployment can never retroactively become the "root" for an earlier one (deployment
// ids are a monotonic SERIAL PK, so this is equivalent to bounding on insertion order/created_at).
export async function findRootApprovedSiblingForCommit(
  commitSha: string,
  githubRepoId: string,
  beforeDeploymentId: number,
): Promise<RootApprovedSibling | null> {
  const result = await pool.query(
    `SELECT d.id, d.monitored_app_id, d.four_eyes_status
     FROM deployments d
     JOIN application_repositories ar
       ON ar.monitored_app_id = d.monitored_app_id
       AND ar.github_owner = d.detected_github_owner
       AND ar.github_repo_name = d.detected_github_repo_name
       AND ar.status IN ('active', 'historical')
     WHERE ar.github_repo_id = $1
       AND d.commit_sha = $2
       AND d.id <= $3
       AND d.four_eyes_status IN (${ROOT_APPROVED_STATUSES_SQL})
     ORDER BY d.created_at ASC, d.id ASC
     LIMIT 1`,
    [githubRepoId, commitSha, beforeDeploymentId],
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    id: row.id,
    monitoredAppId: row.monitored_app_id,
    fourEyesStatus: row.four_eyes_status,
  }
}

// Re-attributes a same-commit, different-app previousDeployment candidate to the true
// root-approved deployment when one exists and differs, so a chain A -> B -> C is attributed
// directly to A instead of B. The root may turn out to belong to the current app itself (a
// same-app redeploy of a commit it already had approved) — in that case the caller's
// monitoredAppId now matches the returned previousDeployment, so downstream logic correctly
// treats this as an ordinary same-app "no_changes" redeploy rather than sibling verification.
export async function preferRootApprovedSibling<
  T extends { id: number; commitSha: string; monitoredAppId?: number; fourEyesStatus?: string },
>(
  previousDeployment: T | null,
  commitSha: string,
  githubRepoId: string | null,
  monitoredAppId: number,
  currentDeploymentId: number,
): Promise<T | null> {
  if (
    !previousDeployment ||
    !githubRepoId ||
    previousDeployment.commitSha !== commitSha ||
    previousDeployment.monitoredAppId == null ||
    previousDeployment.monitoredAppId === monitoredAppId
  ) {
    return previousDeployment
  }

  const root = await findRootApprovedSiblingForCommit(commitSha, githubRepoId, currentDeploymentId)
  if (!root || root.id === previousDeployment.id) return previousDeployment

  return {
    ...previousDeployment,
    id: root.id,
    monitoredAppId: root.monitoredAppId,
    fourEyesStatus: root.fourEyesStatus,
  }
}

export interface PreviousDeploymentResult {
  id: number
  commitSha: string
  createdAt: string
  monitoredAppId: number
  fourEyesStatus: string
}

interface PreviousDeploymentCandidate {
  id: number
  commitSha: string
  createdAt: Date
  monitoredAppId: number
  fourEyesStatus: string
}

const CANDIDATE_PAGE_SIZE = 20
const MAX_CANDIDATE_PAGES = 50
const RATE_LIMIT_SAFETY_BUFFER = 200

async function logZeroCandidateDiagnostics(
  currentDeploymentId: number,
  githubRepoId: string,
  auditStartYear: number | null,
): Promise<void> {
  try {
    const currentResult = await pool.query(
      `SELECT monitored_app_id, detected_github_owner, detected_github_repo_name, created_at, commit_sha, four_eyes_status
       FROM deployments WHERE id = $1`,
      [currentDeploymentId],
    )
    const current = currentResult.rows[0]
    if (!current) return

    const repoRowsResult = await pool.query(
      `SELECT id, github_owner, github_repo_name, github_repo_id, status
       FROM application_repositories WHERE monitored_app_id = $1
       ORDER BY CASE status WHEN 'active' THEN 1 WHEN 'historical' THEN 2 ELSE 3 END, created_at DESC, id DESC
       LIMIT 20`,
      [current.monitored_app_id],
    )

    const olderSameAppResult = await pool.query(
      `SELECT d.id, d.detected_github_owner, d.detected_github_repo_name, d.commit_sha, d.four_eyes_status, d.created_at
       FROM deployments d
       WHERE d.monitored_app_id = $1
         AND (d.created_at, d.id) < (SELECT created_at, id FROM deployments WHERE id = $2)
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT 5`,
      [current.monitored_app_id, currentDeploymentId],
    )

    logger.warn('getPreviousDeployment: zero candidates on first page — diagnostic dump', {
      log_type: 'previous_deployment_zero_candidates_diagnostic',
      currentDeploymentId,
      currentMonitoredAppId: current.monitored_app_id,
      currentDetectedGithubOwner: current.detected_github_owner,
      currentDetectedGithubRepoName: current.detected_github_repo_name,
      currentCreatedAt: current.created_at,
      currentCommitSha: current.commit_sha,
      resolvedGithubRepoId: githubRepoId,
      auditStartYear,
      applicationRepositoryRows: repoRowsResult.rows,
      olderSameAppDeployments: olderSameAppResult.rows,
    })

    if (olderSameAppResult.rows.length > 0) {
      const nearest = olderSameAppResult.rows[0]
      const auditStartDate = auditStartYear ? `${auditStartYear}-01-01` : null
      const nearestCheckResult = await pool.query(
        `SELECT
           d.id,
           d.commit_sha IS NOT NULL AS has_commit_sha,
           d.commit_sha !~ '^refs/' AS commit_sha_not_ref,
           d.four_eyes_status NOT IN (${NON_DIFFABLE_STATUSES_SQL}) AS not_non_diffable,
           d.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL}) AS not_unauthorized,
           EXISTS (
             SELECT 1 FROM application_repositories ar
             WHERE ar.monitored_app_id = d.monitored_app_id
               AND ar.github_owner = d.detected_github_owner
               AND ar.github_repo_name = d.detected_github_repo_name
               AND ar.status IN ('active', 'historical')
               AND ar.github_repo_id = $2
           ) AS matches_application_repository_join,
           ($3::date IS NULL OR d.created_at >= $3::date) AS passes_audit_start_year
         FROM deployments d WHERE d.id = $1`,
        [nearest.id, githubRepoId, auditStartDate],
      )
      logger.warn('getPreviousDeployment: predicate-by-predicate check on nearest older same-app deployment', {
        log_type: 'previous_deployment_zero_candidates_predicate_check',
        currentDeploymentId,
        nearestOlderDeploymentId: nearest.id,
        predicateResults: nearestCheckResult.rows[0],
      })
    }
  } catch (error) {
    logger.warn('getPreviousDeployment: diagnostic dump failed', {
      log_type: 'previous_deployment_zero_candidates_diagnostic_error',
      currentDeploymentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function queryCandidates(
  currentDeploymentId: number,
  githubRepoId: string,
  offset: number,
): Promise<PreviousDeploymentCandidate[]> {
  const params: (number | string)[] = [currentDeploymentId, githubRepoId]
  params.push(CANDIDATE_PAGE_SIZE)
  const limitParamIndex = params.length
  params.push(offset)
  const offsetParamIndex = params.length

  const query = `
    SELECT d.id, d.commit_sha, d.created_at, d.monitored_app_id, d.four_eyes_status
    FROM deployments d
    JOIN application_repositories ar
      ON ar.monitored_app_id = d.monitored_app_id
      AND ar.github_owner = d.detected_github_owner
      AND ar.github_repo_name = d.detected_github_repo_name
      AND ar.status IN ('active', 'historical')
    WHERE (d.created_at, d.id) < (SELECT created_at, id FROM deployments WHERE id = $1)
      AND ar.github_repo_id = $2
      AND d.commit_sha IS NOT NULL
      AND d.four_eyes_status NOT IN (${NON_DIFFABLE_STATUSES_SQL})
      AND d.four_eyes_status NOT IN (${UNAUTHORIZED_STATUSES_SQL})
      AND d.commit_sha !~ '^refs/'
    ORDER BY d.created_at DESC, d.id DESC LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `

  const result = await pool.query(query, params)
  return result.rows.map((row) => ({
    id: row.id,
    commitSha: row.commit_sha,
    createdAt: row.created_at,
    monitoredAppId: row.monitored_app_id,
    fourEyesStatus: row.four_eyes_status,
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
): Promise<PreviousDeploymentResult | 'rate_limited' | null> {
  const knownGithubRepoId = toSafeGithubRepoId(githubRepoId)
  for (const candidate of candidates) {
    const rateLimitRemaining = getGitHubRateLimitRemaining()
    if (rateLimitRemaining !== null && rateLimitRemaining < RATE_LIMIT_SAFETY_BUFFER) {
      logger.warn(
        `⚠️  GitHub rate limit near exhaustion (${rateLimitRemaining} remaining), stopping ancestry search for ${owner}/${repo}`,
      )
      return 'rate_limited'
    }

    const status = await getCommitAncestryStatus(owner, repo, candidate.commitSha, currentCommitSha, knownGithubRepoId)

    if (status === null) {
      logger.warn(
        `⚠️ Could not verify ancestry of candidate previous deployment ${candidate.commitSha.substring(0, 7)} for ${owner}/${repo}, skipping`,
      )
      continue
    }

    if (status === 'identical' || status === 'ahead') {
      return {
        id: candidate.id,
        commitSha: candidate.commitSha,
        createdAt: candidate.createdAt.toISOString(),
        monitoredAppId: candidate.monitoredAppId,
        fourEyesStatus: candidate.fourEyesStatus,
      }
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
): Promise<PreviousDeploymentResult | null | 'rate_limited'> {
  if (!githubRepoId) return null

  let offset = 0
  for (let page = 0; page < MAX_CANDIDATE_PAGES; page++) {
    const candidates = await queryCandidates(currentDeploymentId, githubRepoId, offset)
    if (candidates.length === 0) {
      if (page === 0) await logZeroCandidateDiagnostics(currentDeploymentId, githubRepoId, auditStartYear)
      return null
    }

    const found = await findAncestorCandidate(candidates, owner, repo, currentCommitSha, githubRepoId)
    if (found === 'rate_limited') {
      logger.warn('getPreviousDeployment: stopping ancestry search early due to GitHub rate limit', {
        log_type: 'previous_deployment_rate_limited',
        owner,
        repo,
        githubRepoId,
        currentDeploymentId,
        page,
      })
      return 'rate_limited'
    }
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
