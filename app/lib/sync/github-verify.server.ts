import { type DeploymentFilters, getAllDeployments, updateDeploymentFourEyes } from '~/db/deployments.server'
import { logger } from '~/lib/logger.server'
import { runVerification } from '~/lib/verification'

/**
 * Verify four-eyes status for deployments by checking GitHub.
 * Filters to only pending/error deployments, sorted oldest-first.
 */
export async function verifyDeploymentsFourEyes(filters?: DeploymentFilters & { limit?: number }): Promise<{
  verified: number
  failed: number
  skipped: number
}> {
  logger.info(`🔍 Starting GitHub verification for deployments (limit: ${filters?.limit})`)

  // Get deployments that need verification - fetch all non-approved deployments
  const deploymentsToVerify = await getAllDeployments({
    ...filters,
    only_missing_four_eyes: true,
    per_page: 10000, // Get all deployments, not just first 20
  })

  // Only verify deployments with 'pending' or 'error' status
  // Other statuses (direct_push, unverified_commits, missing, etc.) are final results
  // that can only be changed via manual approval
  const statusesToVerify = ['pending', 'error']
  const needsVerification = deploymentsToVerify.filter(
    (d) => !d.has_four_eyes && d.four_eyes_status !== 'legacy' && statusesToVerify.includes(d.four_eyes_status ?? ''),
  )

  // Sort by created_at ascending (oldest first)
  const prioritized = needsVerification.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  // Apply limit if specified
  const toVerify = filters?.limit ? prioritized.slice(0, filters.limit) : prioritized

  logger.info(`📋 Found ${toVerify.length} deployments needing verification`)

  let verified = 0
  let failed = 0
  let skipped = 0

  for (const deployment of toVerify) {
    try {
      logger.info(`🔍 Verifying deployment ${deployment.nais_deployment_id}...`)

      // Skip deployments without commit SHA - keep current status
      if (!deployment.commit_sha) {
        logger.info(`⏭️  Skipping deployment without commit SHA: ${deployment.nais_deployment_id}`)
        skipped++
        continue
      }

      // Check for invalid SHA (e.g., "refs/heads/main" instead of actual SHA)
      // Treat these as legacy deployments that need manual lookup
      if (deployment.commit_sha.startsWith('refs/')) {
        logger.info(
          `⚠️  Invalid commit SHA (ref instead of SHA): ${deployment.commit_sha} - marking as legacy for manual lookup`,
        )
        await updateDeploymentFourEyes(
          deployment.id,
          {
            hasFourEyes: false,
            fourEyesStatus: 'legacy',
            githubPrNumber: null,
            githubPrUrl: null,
          },
          { changeSource: 'sync' },
        )
        skipped++
        continue
      }

      // Always use V2 verification
      const success = await verifySingleDeployment(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.environment_name,
        deployment.trigger_url,
        deployment.default_branch || 'main',
        deployment.monitored_app_id,
      )

      if (success) {
        verified++
      } else {
        skipped++
      }

      // Small delay to avoid rate limiting
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

/**
 * Verify four-eyes for a single deployment using the modular verification system.
 * Uses database caching and versioned snapshots.
 */
async function verifySingleDeployment(
  deploymentId: number,
  commitSha: string,
  repository: string,
  environmentName: string,
  _triggerUrl?: string | null,
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
    })

    return result.status !== 'error'
  } catch (error) {
    logger.error(`❌ Error in verifySingleDeployment for deployment ${deploymentId}:`, error)

    // Check if it's a rate limit error
    if (error instanceof Error && error.message.includes('rate limit')) {
      logger.warn('⚠️  GitHub rate limit reached, stopping verification')
      throw error
    }

    return false
  }
}
