import { findRepositoryForApp, getMonitoredAppIdsForRepository } from '~/db/application-repositories.server'
import { pool } from '~/db/connection.server'
import { getEffectiveSettingsForApp } from '~/db/repositories.server'
import { getSyncJobById, heartbeatSyncJob, isAppBlockedByRunningJob } from '~/db/sync-jobs.server'
import {
  getCompareSnapshotForCommit,
  getDeploymentsForDiffComputation,
  getPreviousDeploymentForDiff,
} from '~/db/verification-diff.server'
import { isProtectedStatus } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { preferRootApprovedSibling } from './fetch-data/previous-deployment.server'
import {
  buildCommitsBetweenFromCache,
  fetchVerificationData,
  findPrForCommit,
  getPrDataForDiff,
} from './fetch-data.server'
import type { CompareData, VerificationInput } from './types'
import { verifyDeployment } from './verify'

interface ComputeDiffsOptions {
  jobId?: number
  onProgress?: (processed: number, total: number, diffsFound: number) => void | Promise<void>
}

interface ComputeDiffsResult {
  deploymentsChecked: number
  diffsFound: number
  skipped: number
  errors: number
}

const STATUS_EQUIVALENCES: Record<string, string> = {
  approved_pr: 'approved',
  pending_approval: 'pending',
}

export function normalizeStatus(status: string | null): string | null {
  if (!status) return status
  return STATUS_EQUIVALENCES[status] || status
}

export async function computeVerificationDiffs(
  monitoredAppId: number,
  options: ComputeDiffsOptions = {},
): Promise<ComputeDiffsResult> {
  const deployments = await getDeploymentsForDiffComputation(monitoredAppId)
  const { implicitApprovalSettings } = await getEffectiveSettingsForApp(monitoredAppId)

  const result: ComputeDiffsResult = {
    deploymentsChecked: 0,
    diffsFound: 0,
    skipped: 0,
    errors: 0,
  }

  const repoIdCache = new Map<string, { githubRepoId: string | null; status: string | null }>()
  async function resolveRepoInfo(
    owner: string,
    repo: string,
  ): Promise<{ githubRepoId: string | null; status: string | null }> {
    const cacheKey = `${owner}/${repo}`
    const cached = repoIdCache.get(cacheKey)
    if (cached) return cached
    const repoCheck = await findRepositoryForApp(monitoredAppId, owner, repo)
    const info = {
      githubRepoId: repoCheck.repository?.github_repo_id ?? null,
      status: repoCheck.repository?.status ?? null,
    }
    repoIdCache.set(cacheKey, info)
    return info
  }

  const diffs: Array<{
    deploymentId: number
    oldStatus: string | null
    newStatus: string
    errorReason: string | null
  }> = []

  for (const row of deployments) {
    try {
      if (isProtectedStatus(row.four_eyes_status ?? '')) {
        result.skipped++
        result.deploymentsChecked++
        continue
      }

      const owner = row.detected_github_owner as string
      const repo = row.detected_github_repo_name as string

      if (!row.default_branch) {
        result.skipped++
        result.deploymentsChecked++
        continue
      }
      const baseBranch = row.default_branch

      let input: VerificationInput
      let precomputedResult: ReturnType<typeof verifyDeployment> | null = null

      const { githubRepoId, status } = await resolveRepoInfo(owner, repo)
      const previousDeploymentLookupFailed = status === 'active' && !githubRepoId
      const prevRow = githubRepoId ? await getPreviousDeploymentForDiff(row.id, githubRepoId) : null
      const previousDeployment = prevRow
        ? await preferRootApprovedSibling(
            {
              id: prevRow.id,
              commitSha: prevRow.commit_sha,
              createdAt: prevRow.created_at.toISOString(),
              monitoredAppId: prevRow.monitored_app_id,
              fourEyesStatus: prevRow.four_eyes_status,
            },
            row.commit_sha,
            githubRepoId,
            monitoredAppId,
            row.id,
          )
        : null

      const compareSnapshot = await getCompareSnapshotForCommit(
        owner,
        repo,
        row.commit_sha,
        previousDeployment?.commitSha ?? null,
      )
      if (compareSnapshot) {
        const compareData = compareSnapshot.data as CompareData

        const hasCompareMetadata = compareData.compare !== undefined
        const hasSuspiciousCache =
          compareData.commits.length === 0 &&
          previousDeployment &&
          previousDeployment.commitSha !== row.commit_sha &&
          (!hasCompareMetadata || !compareData.compare.noDiffDetected)

        const cacheBaseMismatch = previousDeployment && compareSnapshot.base_sha !== previousDeployment.commitSha

        if (hasSuspiciousCache || cacheBaseMismatch) {
          const reason = cacheBaseMismatch
            ? `snapshot base_sha ${compareSnapshot.base_sha} ≠ previousDeployment ${previousDeployment?.commitSha}`
            : `0 commits between different SHAs`
          logger.info(`   🔄 Cached compare validation failed for deployment ${row.id}: ${reason} — refetching`)
          input = await fetchVerificationData(
            row.id,
            row.commit_sha,
            `${owner}/${repo}`,
            row.environment_name,
            baseBranch,
            monitoredAppId,
          )
        } else {
          const commitsBetween = await buildCommitsBetweenFromCache(owner, repo, baseBranch, compareData, {
            cacheOnly: true,
          })

          let deployedPr: VerificationInput['deployedPr'] = null
          const cachedPrNumber =
            row.github_pr_number ??
            (await findPrForCommit(owner, repo, row.commit_sha, baseBranch, { cacheOnly: true })).prNumber
          if (cachedPrNumber) {
            const prData = await getPrDataForDiff(owner, repo, cachedPrNumber)
            if (prData) {
              deployedPr = {
                number: cachedPrNumber,
                url: `https://github.com/${owner}/${repo}/pull/${cachedPrNumber}`,
                metadata: prData.metadata,
                reviews: prData.reviews,
                commits: prData.commits,
              }
            }
          }

          input = {
            deploymentId: row.id,
            commitSha: row.commit_sha,
            repository: `${owner}/${repo}`,
            environmentName: row.environment_name,
            baseBranch,
            repositoryStatus: 'active',
            commitOnBaseBranch: true,
            auditStartYear: row.audit_start_year,
            implicitApprovalSettings: implicitApprovalSettings ?? { mode: 'off' },
            monitoredAppId,
            previousDeployment,
            previousDeploymentLookupFailed,
            deployedPr,
            commitsBetween,
            compareSummary: hasCompareMetadata ? compareData.compare : null,
            dataFreshness: { deployedPrFetchedAt: null, commitsFetchedAt: null, schemaVersion: 1 },
          }

          const cacheOnlyResult = verifyDeployment(input)
          const normalizedOldStatus = normalizeStatus(row.four_eyes_status)
          const normalizedCacheStatus = normalizeStatus(cacheOnlyResult.status)
          const missingPrSnapshot = cachedPrNumber != null && deployedPr == null

          if (normalizedOldStatus !== normalizedCacheStatus || missingPrSnapshot) {
            const reasons: string[] = []
            if (normalizedOldStatus !== normalizedCacheStatus) {
              reasons.push(`status diff: ${row.four_eyes_status} → ${cacheOnlyResult.status}`)
            }
            if (missingPrSnapshot) {
              reasons.push(`missing PR snapshot for PR#${cachedPrNumber}: cached snapshot is incomplete`)
            }
            logger.info(`   🔄 Re-fetching deployment ${row.id}: ${reasons.join(', ')}`)

            try {
              input = await fetchVerificationData(
                row.id,
                row.commit_sha,
                `${owner}/${repo}`,
                row.environment_name,
                baseBranch,
                monitoredAppId,
                { forceRefresh: true, includeComments: false, includeReviews: false },
              )
            } catch (err) {
              logger.warn(`   ⚠️ Force-refresh failed for deployment ${row.id}, using cache-only result`, {
                error: err instanceof Error ? err.message : String(err),
                stack_trace: err instanceof Error ? err.stack : undefined,
              })
              precomputedResult = cacheOnlyResult
            }
          } else {
            precomputedResult = cacheOnlyResult
          }
        }
      } else {
        logger.info(`   🌐 Fetching fresh data for deployment ${row.id} (no compare snapshot)`)
        input = await fetchVerificationData(
          row.id,
          row.commit_sha,
          `${owner}/${repo}`,
          row.environment_name,
          baseBranch,
          monitoredAppId,
        )
      }

      const newResult = precomputedResult ?? verifyDeployment(input)

      const normalizedOldStatus = normalizeStatus(row.four_eyes_status)
      const normalizedNewStatus = normalizeStatus(newResult.status)
      const statusDifferent = normalizedOldStatus !== normalizedNewStatus

      if (statusDifferent) {
        diffs.push({
          deploymentId: row.id,
          oldStatus: row.four_eyes_status,
          newStatus: newResult.status,
          errorReason: newResult.status === 'error' ? newResult.approvalDetails.reason : null,
        })
      }

      result.deploymentsChecked++
      await options.onProgress?.(result.deploymentsChecked, deployments.length, diffs.length)
    } catch (err) {
      logger.error(`Error computing diff for deployment ${row.id}`, err instanceof Error ? err : new Error(String(err)))
      result.errors++
      result.deploymentsChecked++
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM verification_diffs WHERE monitored_app_id = $1', [monitoredAppId])

    for (const diff of diffs) {
      await client.query(
        `INSERT INTO verification_diffs 
           (monitored_app_id, deployment_id, old_status, new_status, error_reason, computed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [monitoredAppId, diff.deploymentId, diff.oldStatus, diff.newStatus, diff.errorReason],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  result.diffsFound = diffs.length
  logger.info(
    `Verification diffs computed: ${result.deploymentsChecked} checked, ${result.diffsFound} diffs, ${result.skipped} skipped, ${result.errors} errors`,
  )

  return result
}

interface ComputeDiffsForRepositoryOptions {
  jobId?: number
  appIds?: number[]
  onProgress?: (processedApps: number, totalApps: number, diffsFound: number) => void | Promise<void>
}

export interface ComputeDiffsForRepositoryResult extends ComputeDiffsResult {
  appsProcessed: number
  appsTotal: number
  appsSkippedLocked: number
  stoppedEarly: boolean
}

export async function computeVerificationDiffsForRepository(
  repositoryId: number,
  options: ComputeDiffsForRepositoryOptions = {},
): Promise<ComputeDiffsForRepositoryResult> {
  const appIds = options.appIds ?? (await getMonitoredAppIdsForRepository(repositoryId))
  const { jobId } = options

  const result: ComputeDiffsForRepositoryResult = {
    deploymentsChecked: 0,
    diffsFound: 0,
    skipped: 0,
    errors: 0,
    appsProcessed: 0,
    appsTotal: appIds.length,
    appsSkippedLocked: 0,
    stoppedEarly: false,
  }

  for (const appId of appIds) {
    if (jobId) {
      const job = await getSyncJobById(jobId)
      if (job?.status !== 'running') {
        logger.info(
          `Reverify job ${jobId} for repository ${repositoryId} is no longer running (status: ${job?.status ?? 'not found'}) — stopping before app ${appId}`,
        )
        result.stoppedEarly = true
        break
      }
    }

    try {
      if (jobId && (await isAppBlockedByRunningJob(appId, ['reverify_app'], jobId))) {
        logger.info(
          `Skipping reverify for app ${appId} in repository ${repositoryId} — another reverify job is already running for it, or for a repository it is also linked to`,
        )
        result.appsSkippedLocked++
      } else {
        const appResult = await computeVerificationDiffs(appId, {
          jobId,
          onProgress: jobId
            ? async () => {
                await heartbeatSyncJob(jobId)
              }
            : undefined,
        })
        result.deploymentsChecked += appResult.deploymentsChecked
        result.diffsFound += appResult.diffsFound
        result.skipped += appResult.skipped
        result.errors += appResult.errors
      }
    } catch (err) {
      logger.error(
        `Error computing diffs for app ${appId} in repository ${repositoryId}`,
        err instanceof Error ? err : new Error(String(err)),
      )
      result.errors++
    }
    result.appsProcessed++
    await options.onProgress?.(result.appsProcessed, result.appsTotal, result.diffsFound)
  }

  logger.info(
    `Verification diffs computed for repository ${repositoryId}: ${result.appsProcessed}/${appIds.length} apps processed, ${result.deploymentsChecked} deployments checked, ${result.diffsFound} diffs, ${result.skipped} skipped, ${result.errors} errors, ${result.appsSkippedLocked} apps skipped due to lock conflict${result.stoppedEarly ? ' (stopped early — job no longer running)' : ''}`,
  )

  return result
}
