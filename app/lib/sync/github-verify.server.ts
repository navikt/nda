import { pool } from '~/db/connection.server'
import {
  type DeploymentFilters,
  getAllDeployments,
  getDeploymentById,
  updateDeploymentFourEyes,
} from '~/db/deployments.server'
import { isDependabotUser } from '~/lib/dependabot'
import { isApprovedStatus, REVERIFIABLE_STATUSES, REVERIFIABLE_STATUSES_SQL } from '~/lib/four-eyes-status'
import { VALID_COMMIT_SHA_SQL } from '~/lib/git-constants'
import { getGitHubRateLimitRemaining } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import { refreshCommitChecksOnly, runVerification } from '~/lib/verification'
import { autoLinkDependabotGoal, autoLinkGoalKeywords } from './goal-keyword-sync.server'

const RATE_LIMIT_SAFETY_BUFFER = 200

// Deployments whose four_eyes_status is already resolved (i.e. not in REVERIFIABLE_STATUSES) are never
// picked up again by verifyDeploymentsFourEyes(), since their status won't change. Checks are independent
// of four_eyes_status, though, so a deployment whose checks were still in-progress (isDefinitive: false)
// at the moment its status resolved would otherwise never have its checks refreshed again. GitHub gives no
// signal for "this check run will never complete" (a check run can in principle stay queued/in_progress
// forever, e.g. an abandoned self-hosted runner or a third-party GitHub App integration that never posts a
// final status) - there is no definitive way to detect that from the API. As a pragmatic bound, we stop
// polling once the deployment is older than this window: GitHub Actions itself enforces a default 6-hour
// per-job timeout (configurable up to 35 days), so any real, still-running CI should resolve well within a
// day; anything older than this is treated as abandoned and is no longer retried automatically.
export const CHECKS_REVERIFY_GIVE_UP_MS = 24 * 60 * 60 * 1000
export const CHECKS_REVERIFY_LIMIT_PER_APP = 50

interface PendingChecksRow {
  id: number
  commit_sha: string
  detected_github_owner: string
  detected_github_repo_name: string
  github_pr_number: number | null
}

/**
 * Refreshes commit_checks_data for deployments whose four_eyes_status is already resolved (so they're no
 * longer visited by verifyDeploymentsFourEyes()) but whose checks are still not definitive
 * (commit_checks_checked_at IS NULL). Bounded by CHECKS_REVERIFY_GIVE_UP_MS so deployments with checks that
 * never converge don't get retried forever.
 */
export async function reverifyPendingChecks(
  monitoredAppId: number,
  limit: number = CHECKS_REVERIFY_LIMIT_PER_APP,
): Promise<{ fetched: number; errors: number }> {
  const giveUpBefore = new Date(Date.now() - CHECKS_REVERIFY_GIVE_UP_MS)

  const { rows } = await pool.query<PendingChecksRow>(
    `SELECT d.id, d.commit_sha, d.detected_github_owner, d.detected_github_repo_name, d.github_pr_number
     FROM deployments d
     WHERE d.monitored_app_id = $1
       AND d.commit_checks_checked_at IS NULL
       AND d.detected_github_owner IS NOT NULL
       AND d.detected_github_repo_name IS NOT NULL
       AND ${VALID_COMMIT_SHA_SQL}
       AND COALESCE(d.four_eyes_status, 'unknown') NOT IN (${REVERIFIABLE_STATUSES_SQL}, 'error')
       AND d.created_at > $2
     ORDER BY d.created_at ASC
     LIMIT $3`,
    [monitoredAppId, giveUpBefore, limit],
  )

  let fetched = 0
  let errors = 0

  for (const deployment of rows) {
    const rateLimitRemaining = getGitHubRateLimitRemaining()
    if (rateLimitRemaining !== null && rateLimitRemaining < RATE_LIMIT_SAFETY_BUFFER) {
      logger.warn(`⚠️  GitHub rate limit near exhaustion (${rateLimitRemaining} remaining), stopping checks reverify`)
      break
    }

    try {
      await refreshCommitChecksOnly(
        deployment.id,
        deployment.detected_github_owner,
        deployment.detected_github_repo_name,
        deployment.commit_sha,
        deployment.github_pr_number,
      )
      fetched++
    } catch (error) {
      errors++
      logger.error(`❌ Error refreshing pending checks for deployment ${deployment.id}:`, error)
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return { fetched, errors }
}

export async function verifyDeploymentsFourEyes(filters?: DeploymentFilters & { limit?: number }): Promise<{
  verified: number
  failed: number
  skipped: number
  remaining: number
}> {
  logger.info(`🔍 Starting GitHub verification for deployments (limit: ${filters?.limit})`)

  const deploymentsToVerify = await getAllDeployments({
    ...filters,
    only_missing_four_eyes: true,
    per_page: 10000, // Get all deployments, not just first 20
  })

  const statusesToVerify = [...REVERIFIABLE_STATUSES, 'error']
  const needsVerification = deploymentsToVerify.filter(
    (d) =>
      !isApprovedStatus(d.four_eyes_status ?? '') &&
      d.four_eyes_status !== 'legacy' &&
      statusesToVerify.includes(d.four_eyes_status ?? ''),
  )

  let grouped: Set<number> | null = null
  const pendingBaselines = needsVerification.filter((d) => d.four_eyes_status === 'pending_baseline')
  if (pendingBaselines.length > 0) {
    const appIds = [...new Set(pendingBaselines.map((d) => d.monitored_app_id))]
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM monitored_applications WHERE id = ANY($1) AND application_group_id IS NOT NULL`,
      [appIds],
    )
    grouped = new Set(rows.map((r) => r.id))
  }

  const filtered = needsVerification.filter(
    (d) => d.four_eyes_status !== 'pending_baseline' || grouped?.has(d.monitored_app_id),
  )

  const prioritized = filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const toVerify = filters?.limit ? prioritized.slice(0, filters.limit) : prioritized

  logger.info(`📋 Found ${toVerify.length} deployments needing verification`)

  let verified = 0
  let failed = 0
  let skipped = 0
  let processedCount = 0
  let rateLimitHit = false

  for (const deployment of toVerify) {
    const rateLimitRemaining = getGitHubRateLimitRemaining()
    if (rateLimitRemaining !== null && rateLimitRemaining < RATE_LIMIT_SAFETY_BUFFER) {
      logger.warn(`⚠️  GitHub rate limit near exhaustion (${rateLimitRemaining} remaining), stopping verification run`)
      rateLimitHit = true
      break
    }

    processedCount++

    try {
      logger.info(`🔍 Verifying deployment ${deployment.nais_deployment_id}...`)

      if (!deployment.commit_sha) {
        logger.info(`⏭️  Skipping deployment without commit SHA: ${deployment.nais_deployment_id}`)
        skipped++
        continue
      }

      if (deployment.commit_sha.startsWith('refs/')) {
        logger.info(
          `⚠️  Invalid commit SHA (ref instead of SHA): ${deployment.commit_sha} - marking as legacy for manual lookup`,
        )
        await updateDeploymentFourEyes(
          deployment.id,
          {
            fourEyesStatus: 'legacy',
            githubPrNumber: null,
            githubPrUrl: null,
          },
          { changeSource: 'sync' },
        )
        skipped++
        continue
      }

      if (!deployment.default_branch) {
        skipped++
        continue
      }

      const success = await verifySingleDeployment(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.environment_name,
        deployment.trigger_url,
        deployment.default_branch,
        deployment.monitored_app_id,
      )

      if (success) {
        verified++

        try {
          const freshDeployment = await getDeploymentById(deployment.id)
          if (freshDeployment) {
            const commitInfos = extractCommitInfos(freshDeployment as Parameters<typeof extractCommitInfos>[0])
            if (commitInfos.length > 0) {
              await autoLinkGoalKeywords(
                freshDeployment.id,
                freshDeployment.team_slug,
                freshDeployment.monitored_app_id,
                commitInfos,
              )
            }

            const prCreator = (freshDeployment as { github_pr_data?: { creator?: { username?: string } } | null })
              .github_pr_data?.creator?.username
            if (isDependabotUser(prCreator)) {
              await autoLinkDependabotGoal(
                freshDeployment.id,
                freshDeployment.team_slug,
                freshDeployment.monitored_app_id,
                new Date(freshDeployment.created_at),
              )
            }
          }
        } catch (e) {
          logger.warn(`⚠️  Goal auto-linking failed for deployment ${deployment.id}`, {
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          })
        }
      } else {
        skipped++
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      logger.error(`❌ Error verifying deployment ${deployment.nais_deployment_id}:`, error)
      failed++

      if (error instanceof Error && error.message.includes('rate limit')) {
        logger.warn('⚠️  GitHub rate limit reached, stopping verification run')
        rateLimitHit = true
        break
      }
    }
  }

  const remaining = Math.max(0, filtered.length - processedCount)

  logger.info(`✅ Verification complete:`, {
    verified,
    failed,
    skipped,
    remaining,
    rateLimitHit,
  })

  return {
    verified,
    failed,
    skipped,
    remaining,
  }
}

async function verifySingleDeployment(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  triggerUrl?: string | null,
  baseBranch: string = 'main',
  monitoredAppId?: number,
): Promise<boolean> {
  if (!monitoredAppId) {
    logger.warn(`⚠️  verifySingleDeployment requires monitoredAppId`)
    return false
  }

  try {
    const result = await runVerification(deploymentId, {
      commitSha,
      repository,
      environmentName,
      baseBranch,
      monitoredAppId,
      triggerUrl,
    })

    return result.status !== 'error'
  } catch (error) {
    logger.error(`❌ Error in verifySingleDeployment for deployment ${deploymentId}:`, error)

    if (error instanceof Error && error.message.includes('rate limit')) {
      logger.warn('⚠️  GitHub rate limit reached, stopping verification')
      throw error
    }

    return false
  }
}

export function extractCommitInfos(deployment: {
  title?: string | null
  created_at: string | Date
  unverified_commits?: Array<{ message?: string; date?: string }> | null
  github_pr_data?: {
    title?: string
    head_branch?: string
    commits?: Array<{ commit?: { message?: string }; message?: string; sha?: string; date?: string }>
  } | null
}): Array<{ message: string; date: Date }> {
  const infos: Array<{ message: string; date: Date }> = []
  const deployDate = new Date(deployment.created_at)

  if (deployment.title) {
    infos.push({ message: deployment.title, date: deployDate })
  }

  if (deployment.github_pr_data?.head_branch) {
    infos.push({ message: deployment.github_pr_data.head_branch, date: deployDate })
  }

  if (Array.isArray(deployment.unverified_commits)) {
    for (const c of deployment.unverified_commits) {
      if (c.message) {
        infos.push({ message: c.message, date: c.date ? new Date(c.date) : deployDate })
      }
    }
  }

  if (deployment.github_pr_data?.commits) {
    for (const c of deployment.github_pr_data.commits) {
      const message = c.message ?? c.commit?.message
      if (message) {
        infos.push({ message, date: c.date ? new Date(c.date) : deployDate })
      }
    }
  }

  return infos
}
