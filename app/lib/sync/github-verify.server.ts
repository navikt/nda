import { pool } from '~/db/connection.server'
import {
  type DeploymentFilters,
  getAllDeployments,
  getDeploymentById,
  updateDeploymentFourEyes,
} from '~/db/deployments.server'
import { isDependabotUser } from '~/lib/dependabot'
import { isApprovedStatus, REVERIFIABLE_STATUSES } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { runVerification } from '~/lib/verification'
import { autoLinkDependabotGoal, autoLinkGoalKeywords } from './goal-keyword-sync.server'

export async function verifyDeploymentsFourEyes(filters?: DeploymentFilters & { limit?: number }): Promise<{
  verified: number
  failed: number
  skipped: number
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

  for (const deployment of toVerify) {
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
    }
  }

  logger.info(`✅ Verification complete:`, {
    verified,
    failed,
    skipped,
  })

  return {
    verified,
    failed,
    skipped,
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
