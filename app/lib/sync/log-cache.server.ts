import { pool } from '~/db/connection.server'
import { isGcsConfigured, logExists, uploadLog } from '~/lib/gcs.server'
import { getGitHubClient } from '~/lib/github'
import { logger } from '~/lib/logger.server'

interface CheckToCache {
  deployment_id: number
  owner: string
  repo: string
  check_id: number
  check_name: string
}

interface CacheCheckLogsResult {
  cached: number
  diagnostics: {
    gcsConfigured: boolean
    deploymentsLast7Days: number
    deploymentsWithPrData: number
    deploymentsWithChecks: number
    deploymentsWithRepo: number
    checksTotal: number
    skippedNoRepo: number
    skippedNoId: number
    skippedAlreadyCached: number
    skippedNotCompleted: number
  }
}

/**
 * Find recent deployments with completed checks whose logs haven't been cached yet.
 * Limits to deployments from the last 7 days to stay within API quotas.
 */
async function getUncachedChecks(monitoredAppId: number): Promise<{
  checks: CheckToCache[]
  diagnostics: CacheCheckLogsResult['diagnostics']
}> {
  const diagnostics: CacheCheckLogsResult['diagnostics'] = {
    gcsConfigured: true,
    deploymentsLast7Days: 0,
    deploymentsWithPrData: 0,
    deploymentsWithChecks: 0,
    deploymentsWithRepo: 0,
    checksTotal: 0,
    skippedNoRepo: 0,
    skippedNoId: 0,
    skippedAlreadyCached: 0,
    skippedNotCompleted: 0,
  }

  const statsResult = await pool.query<{
    total_deployments: string
    with_pr_data: string
    with_checks: string
    with_repo: string
  }>(
    `
    SELECT 
      COUNT(*) as total_deployments,
      COUNT(CASE WHEN d.github_pr_data IS NOT NULL THEN 1 END) as with_pr_data,
      COUNT(CASE WHEN d.github_pr_data->'checks' IS NOT NULL THEN 1 END) as with_checks,
      COUNT(CASE WHEN ar.github_repo_name IS NOT NULL THEN 1 END) as with_repo
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    LEFT JOIN application_repositories ar ON ar.monitored_app_id = ma.id
    WHERE d.monitored_app_id = $1
      AND d.created_at >= NOW() - INTERVAL '7 days'
      AND ma.is_active = true
    `,
    [monitoredAppId],
  )

  if (statsResult.rows.length > 0) {
    const s = statsResult.rows[0]
    diagnostics.deploymentsLast7Days = parseInt(s.total_deployments, 10)
    diagnostics.deploymentsWithPrData = parseInt(s.with_pr_data, 10)
    diagnostics.deploymentsWithChecks = parseInt(s.with_checks, 10)
    diagnostics.deploymentsWithRepo = parseInt(s.with_repo, 10)
  }

  const result = await pool.query<{
    id: number
    github_pr_data: {
      checks: Array<{
        id?: number
        name: string
        status: string
        conclusion: string | null
        log_cached?: boolean
      }>
    }
    repository_full_name: string | null
  }>(
    `
    SELECT d.id, d.github_pr_data,
           ar.github_owner || '/' || ar.github_repo_name as repository_full_name
    FROM deployments d
    JOIN monitored_applications ma ON d.monitored_app_id = ma.id
    LEFT JOIN application_repositories ar ON ar.monitored_app_id = ma.id
    WHERE d.monitored_app_id = $1
      AND d.created_at >= NOW() - INTERVAL '7 days'
      AND d.github_pr_data IS NOT NULL
      AND d.github_pr_data->'checks' IS NOT NULL
      AND ma.is_active = true
    ORDER BY d.created_at DESC
    LIMIT 100
  `,
    [monitoredAppId],
  )

  const checks: CheckToCache[] = []

  for (const row of result.rows) {
    if (!row.github_pr_data?.checks || !row.repository_full_name) {
      if (!row.repository_full_name) diagnostics.skippedNoRepo++
      continue
    }
    const [owner, repo] = row.repository_full_name.split('/')
    if (!owner || !repo) continue

    for (const check of row.github_pr_data.checks) {
      diagnostics.checksTotal++
      if (!check.id) {
        diagnostics.skippedNoId++
        continue
      }
      if (check.log_cached) {
        diagnostics.skippedAlreadyCached++
        continue
      }
      if (check.status !== 'completed') {
        diagnostics.skippedNotCompleted++
        continue
      }

      checks.push({
        deployment_id: row.id,
        owner,
        repo,
        check_id: check.id,
        check_name: check.name,
      })
    }
  }

  return { checks, diagnostics }
}

/**
 * Cache logs for all completed checks for a specific app to GCS.
 * Returns the number of logs successfully cached.
 */
export async function cacheCheckLogs(monitoredAppId: number): Promise<CacheCheckLogsResult> {
  if (!isGcsConfigured()) {
    return {
      cached: 0,
      diagnostics: {
        gcsConfigured: false,
        deploymentsLast7Days: 0,
        deploymentsWithPrData: 0,
        deploymentsWithChecks: 0,
        deploymentsWithRepo: 0,
        checksTotal: 0,
        skippedNoRepo: 0,
        skippedNoId: 0,
        skippedAlreadyCached: 0,
        skippedNotCompleted: 0,
      },
    }
  }

  const { checks, diagnostics } = await getUncachedChecks(monitoredAppId)
  if (checks.length === 0) return { cached: 0, diagnostics }

  logger.info(`Found ${checks.length} check logs to cache`)

  let cached = 0
  const client = getGitHubClient()

  for (const check of checks) {
    try {
      // Skip if already in GCS
      if (await logExists(check.owner, check.repo, check.check_id)) {
        await markLogCached(check.deployment_id, check.check_id)
        cached++
        continue
      }

      const response = await client.actions.downloadJobLogsForWorkflowRun({
        owner: check.owner,
        repo: check.repo,
        job_id: check.check_id,
      })

      await uploadLog(check.owner, check.repo, check.check_id, response.data as string)
      await markLogCached(check.deployment_id, check.check_id)
      cached++
    } catch (error) {
      const is404 = error instanceof Error && 'status' in error && (error as { status: number }).status === 404
      if (is404) {
        // Log not available on GitHub (expired or not generated) — mark as cached to skip future retries
        await markLogCached(check.deployment_id, check.check_id)
        logger.info(
          `Log not found (404) for ${check.owner}/${check.repo} check ${check.check_name} (${check.check_id}) — marked as cached`,
        )
      } else {
        logger.warn(
          `Could not cache log for ${check.owner}/${check.repo} check ${check.check_name} (${check.check_id}): ${error}`,
        )
      }
    }
  }

  return { cached, diagnostics }
}

/**
 * Mark a check's log as cached in the deployment's github_pr_data.
 */
async function markLogCached(deploymentId: number, checkId: number): Promise<void> {
  await pool.query(
    `UPDATE deployments
     SET github_pr_data = jsonb_set(
       github_pr_data,
       (
         SELECT ARRAY['checks', (idx - 1)::text, 'log_cached']
         FROM jsonb_array_elements(github_pr_data->'checks') WITH ORDINALITY AS c(elem, idx)
         WHERE (elem->>'id')::bigint = $2::bigint
         LIMIT 1
       ),
       'true'::jsonb
     )
     WHERE id = $1
       AND github_pr_data->'checks' IS NOT NULL`,
    [deploymentId, checkId],
  )
}
