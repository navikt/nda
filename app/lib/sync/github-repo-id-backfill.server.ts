import { pool } from '~/db/connection.server'
import { heartbeatSyncJob, isSyncJobCancelled, updateSyncJobProgress } from '~/db/sync-jobs.server'
import { getRepositoryId } from '~/lib/github/git.server'
import { logger } from '~/lib/logger.server'

export async function countApplicationRepositoriesMissingGithubRepoId(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM application_repositories WHERE github_repo_id IS NULL`,
  )
  return parseInt(result.rows[0].count, 10)
}

export interface GithubRepoIdBackfillResult {
  processed: number
  total: number
  fetched: number
  errors: number
}

interface DistinctRepoRow {
  github_owner: string
  github_repo_name: string
}

export async function backfillGithubRepoIdsForAllRepositories(options?: {
  jobId?: number
  onProgress?: (progress: GithubRepoIdBackfillResult) => void | Promise<void>
}): Promise<GithubRepoIdBackfillResult> {
  const jobId = options?.jobId

  const reposResult = await pool.query<DistinctRepoRow>(
    `SELECT DISTINCT github_owner, github_repo_name
     FROM application_repositories
     WHERE github_repo_id IS NULL
     ORDER BY github_owner, github_repo_name`,
  )
  const repos = reposResult.rows

  const result: GithubRepoIdBackfillResult = {
    processed: 0,
    total: repos.length,
    fetched: 0,
    errors: 0,
  }

  for (const repo of repos) {
    if (jobId && (await isSyncJobCancelled(jobId))) {
      break
    }

    try {
      const githubRepoId = await getRepositoryId(repo.github_owner, repo.github_repo_name)
      if (githubRepoId !== null) {
        await pool.query(
          `UPDATE application_repositories
           SET github_repo_id = $1
           WHERE github_owner = $2 AND github_repo_name = $3 AND github_repo_id IS NULL`,
          [githubRepoId, repo.github_owner, repo.github_repo_name],
        )
        result.fetched++
      } else {
        result.errors++
      }
    } catch (err) {
      logger.error(
        `Henting av github_repo_id feilet for ${repo.github_owner}/${repo.github_repo_name}`,
        err instanceof Error ? err : new Error(String(err)),
      )
      result.errors++
    }

    result.processed++

    if (jobId && result.processed % 10 === 0) {
      await updateSyncJobProgress(jobId, result as unknown as Record<string, unknown>)
      await heartbeatSyncJob(jobId, 30)
    }
    await options?.onProgress?.(result)
  }

  if (jobId) {
    await updateSyncJobProgress(jobId, result as unknown as Record<string, unknown>)
  }

  return result
}
