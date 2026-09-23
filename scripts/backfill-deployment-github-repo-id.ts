#!/usr/bin/env tsx
/**
 * Backfill github_repo_id for existing deployments using GitHub Actions workflow run data
 *
 * For each deployment with github_repo_id IS NULL and a trigger_url pointing to a
 * GitHub Actions run, resolves the immutable repository id from the workflow run
 * (cached snapshot first, then a live API call) and persists it. Deployments without
 * a trigger_url (e.g. manual `nais deploy`) or whose workflow run can no longer be
 * found (expired/deleted upstream, or repository name reused by an unrelated repo)
 * are left as NULL — this is safe and expected, not an error.
 *
 * Run with: tsx scripts/backfill-deployment-github-repo-id.ts
 */

import 'dotenv/config'
import { pool } from '../app/db/connection.server'
import { resolveGithubRepoIdFromWorkflowRun } from '../app/lib/github/git.server'
import { logger } from '../app/lib/logger.server'

async function backfillDeploymentGithubRepoIds() {
  try {
    logger.info('🔄 Starting deployment github_repo_id backfill via workflow runs...')

    const { rows } = await pool.query<{
      id: number
      trigger_url: string
      detected_github_owner: string
      detected_github_repo_name: string
    }>(`
      SELECT id, trigger_url, detected_github_owner, detected_github_repo_name
      FROM deployments
      WHERE github_repo_id IS NULL
        AND trigger_url IS NOT NULL
        AND detected_github_owner IS NOT NULL
        AND detected_github_repo_name IS NOT NULL
      ORDER BY id
    `)

    if (rows.length === 0) {
      logger.info('✅ No deployments need backfilling')
      return
    }

    logger.info(`📊 Found ${rows.length} deployments to attempt backfill for`)

    let resolved = 0
    let unresolved = 0

    for (const row of rows) {
      const repositoryId = await resolveGithubRepoIdFromWorkflowRun(
        row.detected_github_owner,
        row.detected_github_repo_name,
        row.trigger_url,
      )

      if (repositoryId === null) {
        unresolved++
        continue
      }

      await pool.query(`UPDATE deployments SET github_repo_id = $1 WHERE id = $2 AND github_repo_id IS NULL`, [
        repositoryId,
        row.id,
      ])
      resolved++

      if ((resolved + unresolved) % 50 === 0) {
        logger.info(`  ... processed ${resolved + unresolved}/${rows.length} (resolved: ${resolved})`)
      }
    }

    logger.info(`✅ Backfill complete: ${resolved} resolved, ${unresolved} left as NULL`)
  } catch (error) {
    logger.error('❌ Backfill failed:', error as Record<string, unknown>)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

backfillDeploymentGithubRepoIds()
