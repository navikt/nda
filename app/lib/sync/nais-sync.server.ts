import { createRepositoryAlert } from '~/db/alerts.server'
import {
  findRepositoryForApp,
  getRepositoriesByAppId,
  upsertApplicationRepository,
} from '~/db/application-repositories.server'
import {
  type CreateDeploymentParams,
  createDeployment,
  getDeploymentByNaisId,
  getLatestDeploymentForApp,
} from '~/db/deployments.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { logger } from '~/lib/logger.server'
import { fetchApplicationDeployments, fetchNewDeployments } from '~/lib/nais.server'

/**
 * Step 1: Sync deployments from Nais API to database
 * This ONLY fetches from Nais and stores to DB - no GitHub calls
 */
async function syncDeploymentsFromNais(
  teamSlug: string,
  environmentName: string,
  appName: string,
): Promise<{
  newCount: number
  skippedCount: number
  alertsCreated: number
  totalProcessed: number
}> {
  logger.info('📥 Syncing deployments from Nais (no GitHub verification):', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
  })

  // Get the monitored application
  const monitoredApp = await getMonitoredApplicationByIdentity(teamSlug, environmentName, appName)
  if (!monitoredApp) {
    throw new Error(`Application not found in monitored applications: ${teamSlug}/${environmentName}/${appName}`)
  }

  // Fetch deployments from Nais
  const naisDeployments = await fetchApplicationDeployments(teamSlug, environmentName, appName)

  logger.info(`📦 Processing ${naisDeployments.length} deployments from Nais`)

  let newCount = 0
  let skippedCount = 0
  let alertsCreated = 0
  let totalProcessed = 0

  for (const naisDep of naisDeployments) {
    totalProcessed++

    // Skip deployments without repository info
    if (!naisDep.repository) {
      logger.warn(`⚠️  Skipping deployment without repository: ${naisDep.id}`)
      skippedCount++
      continue
    }

    // Extract GitHub owner/repo from repository field
    const repoParts = naisDep.repository.split('/')
    if (repoParts.length !== 2) {
      logger.warn(`⚠️  Invalid repository format: ${naisDep.repository}`)
      skippedCount++
      continue
    }

    const [detectedOwner, detectedRepoName] = repoParts

    // Check if deployment already exists
    const existingDep = await getDeploymentByNaisId(naisDep.id)

    if (existingDep) {
      logger.info(`⏭️  Deployment already exists: ${naisDep.id}`)
      skippedCount++
      continue
    }

    // Create deployment record first (WITHOUT four-eyes verification)
    logger.info(`➕ Creating new deployment: ${naisDep.id}`)

    const deploymentParams: CreateDeploymentParams = {
      monitoredApplicationId: monitoredApp.id,
      naisDeploymentId: naisDep.id,
      createdAt: new Date(naisDep.createdAt),
      teamSlug: teamSlug,
      environmentName: environmentName,
      appName: appName,
      commitSha: naisDep.commitSha,
      deployerUsername: naisDep.deployerUsername,
      triggerUrl: naisDep.triggerUrl,
      detectedGithubOwner: detectedOwner,
      detectedGithubRepoName: detectedRepoName,
      resources: naisDep.resources.nodes,
    }

    await createDeployment(deploymentParams)
    newCount++

    // Skip repository checks for legacy deployments (before 2025-01-01 without commit SHA)
    const legacyCutoffDate = new Date('2025-01-01T00:00:00Z')
    const isLegacyDeployment = new Date(naisDep.createdAt) < legacyCutoffDate && !naisDep.commitSha
    if (isLegacyDeployment) {
      logger.info(`⏭️  Skipping repository checks for legacy deployment: ${naisDep.id}`)
      continue
    }

    // Check repository status using application_repositories
    const repoCheck = await findRepositoryForApp(monitoredApp.id, detectedOwner, detectedRepoName)

    if (!repoCheck.repository) {
      // Repository not found - create pending approval entry
      logger.warn(`🆕 New repository detected for app ${appName}: ${detectedOwner}/${detectedRepoName}`)

      // Check if this is the first repo for this app
      const existingRepos = await getRepositoriesByAppId(monitoredApp.id)

      if (existingRepos.length === 0) {
        // First repo - auto-approve as active
        logger.info(`📝 Auto-approving first repository as active`)
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: detectedOwner,
          githubRepoName: detectedRepoName,
          status: 'active',
          approvedBy: 'system',
        })
      } else {
        // Additional repo - require approval
        logger.info(`⏸️  Creating pending approval entry`)
        await upsertApplicationRepository({
          monitoredAppId: monitoredApp.id,
          githubOwner: detectedOwner,
          githubRepoName: detectedRepoName,
          status: 'pending_approval',
        })

        // Create alert
        await createRepositoryAlert({
          monitoredApplicationId: monitoredApp.id,
          deploymentNaisId: naisDep.id,
          detectedGithubOwner: detectedOwner,
          detectedGithubRepoName: detectedRepoName,
          alertType: 'pending_approval',
        })

        alertsCreated++
      }
    } else if (repoCheck.repository.status === 'pending_approval') {
      // Repository exists but pending approval
      logger.warn(`⏸️  Deployment from pending approval repository: ${detectedOwner}/${detectedRepoName}`)

      await createRepositoryAlert({
        monitoredApplicationId: monitoredApp.id,
        deploymentNaisId: naisDep.id,
        detectedGithubOwner: detectedOwner,
        detectedGithubRepoName: detectedRepoName,
        alertType: 'pending_approval',
      })

      alertsCreated++
    } else if (repoCheck.repository.status === 'historical') {
      // Repository is historical (not active)
      logger.warn(`⚠️  Deployment from historical repository: ${detectedOwner}/${detectedRepoName}`)

      // Get active repo for context
      const activeRepo = (await getRepositoriesByAppId(monitoredApp.id)).find((r) => r.status === 'active')

      await createRepositoryAlert({
        monitoredApplicationId: monitoredApp.id,
        deploymentNaisId: naisDep.id,
        detectedGithubOwner: detectedOwner,
        detectedGithubRepoName: detectedRepoName,
        expectedGithubOwner: activeRepo?.github_owner || detectedOwner,
        expectedGithubRepoName: activeRepo?.github_repo_name || detectedRepoName,
        alertType: 'historical_repository',
      })

      alertsCreated++
    }
    // else: repository is active - all good, no alert needed
  }

  logger.info(`✅ Nais sync complete:`, {
    newCount,
    skippedCount,
    alertsCreated,
    totalProcessed,
  })

  return {
    newCount,
    skippedCount,
    alertsCreated,
    totalProcessed,
  }
}

/**
 * Incremental sync - only fetches new deployments since last sync
 * Stops as soon as it finds a deployment already in the database
 * Much faster for periodic syncs
 */
export async function syncNewDeploymentsFromNais(
  teamSlug: string,
  environmentName: string,
  appName: string,
  monitoredAppId: number,
): Promise<{
  newCount: number
  alertsCreated: number
  stoppedEarly: boolean
}> {
  logger.info('📥 Incremental sync - fetching only new deployments:', {
    team: teamSlug,
    environment: environmentName,
    app: appName,
  })

  // Get the latest deployment we have for this app
  const latestDeployment = await getLatestDeploymentForApp(monitoredAppId)

  if (!latestDeployment) {
    // No deployments yet - fall back to full sync
    logger.info('📋 No existing deployments - performing full sync instead')
    const result = await syncDeploymentsFromNais(teamSlug, environmentName, appName)
    return {
      newCount: result.newCount,
      alertsCreated: result.alertsCreated,
      stoppedEarly: false,
    }
  }

  logger.info(`🔍 Looking for deployments newer than ${latestDeployment.nais_deployment_id.substring(0, 20)}...`)

  // Fetch only new deployments
  const { deployments, stoppedEarly } = await fetchNewDeployments(
    teamSlug,
    environmentName,
    appName,
    latestDeployment.nais_deployment_id,
    100, // Smaller page size for incremental
  )

  if (deployments.length === 0) {
    logger.info('✅ No new deployments found')
    return { newCount: 0, alertsCreated: 0, stoppedEarly }
  }

  logger.info(`📦 Processing ${deployments.length} new deployments`)

  let newCount = 0
  const alertsCreated = 0
  let detectedRepository: { owner: string; repo: string } | null = null

  for (const deployment of deployments) {
    // Double-check it doesn't exist (in case of race condition)
    const existing = await getDeploymentByNaisId(deployment.id)
    if (existing) {
      logger.info(`⏭️  Already exists: ${deployment.id}`)
      continue
    }

    // Parse repository from Nais data
    if (deployment.repository) {
      const match = deployment.repository.match(/github\.com\/([^/]+)\/([^/]+)/)
      if (match) {
        detectedRepository = { owner: match[1], repo: match[2] }
      } else if (deployment.repository.includes('/')) {
        const parts = deployment.repository.split('/')
        detectedRepository = { owner: parts[0], repo: parts[1] }
      }
    }

    // Extract resources
    const resources = deployment.resources?.nodes?.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
    }))

    logger.info(`➕ Creating new deployment: ${deployment.id}`)
    await createDeployment({
      monitoredApplicationId: monitoredAppId,
      naisDeploymentId: deployment.id,
      createdAt: new Date(deployment.createdAt),
      teamSlug: deployment.teamSlug,
      environmentName: deployment.environmentName,
      appName,
      deployerUsername: deployment.deployerUsername,
      commitSha: deployment.commitSha,
      triggerUrl: deployment.triggerUrl,
      detectedGithubOwner: detectedRepository?.owner || '',
      detectedGithubRepoName: detectedRepository?.repo || '',
      resources,
    })
    newCount++
  }

  // Check for repository mismatches if we detected a repo
  if (detectedRepository) {
    const existingRepos = await getRepositoriesByAppId(monitoredAppId)
    const matchingRepo = existingRepos.find(
      (r) => r.github_owner === detectedRepository.owner && r.github_repo_name === detectedRepository.repo,
    )

    if (!matchingRepo) {
      // New repository detected - create it (but skip alert for incremental sync)
      await upsertApplicationRepository({
        monitoredAppId,
        githubOwner: detectedRepository.owner,
        githubRepoName: detectedRepository.repo,
        status: 'active',
      })
      logger.info(`📌 New repository detected: ${detectedRepository.owner}/${detectedRepository.repo}`)
    }
  }

  logger.info(`✅ Incremental sync complete: ${newCount} new, ${alertsCreated} alerts`)
  return { newCount, alertsCreated, stoppedEarly }
}
