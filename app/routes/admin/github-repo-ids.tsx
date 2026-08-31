import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Loader, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { useFetcher, useLoaderData, useRevalidator } from 'react-router'
import { pool } from '~/db/connection.server'
import { getSyncJobById, isSyncJobCancelled, releaseExpiredLocks } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import {
  backfillGithubRepoIdsForAllRepositories,
  countApplicationRepositoriesMissingGithubRepoId,
  type GithubRepoIdBackfillResult,
} from '~/lib/sync/github-repo-id-backfill.server'
import type { Route } from './+types/github-repo-ids'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'GitHub repo-ID (alle repoer) - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const missingCount = await countApplicationRepositoriesMissingGithubRepoId()

  const jobResult = await pool.query(
    `SELECT id, status, result, started_at, completed_at
     FROM sync_jobs
     WHERE job_type = 'backfill_github_repo_ids' AND monitored_app_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
  )
  const latestJob = jobResult.rows[0] || null

  return { missingCount, latestJob }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const actionType = formData.get('action') as string

  if (actionType === 'backfill_all') {
    await releaseExpiredLocks()

    const existingJob = await pool.query(
      `SELECT id FROM sync_jobs WHERE job_type = 'backfill_github_repo_ids' AND monitored_app_id IS NULL AND status = 'running' LIMIT 1`,
    )
    if (existingJob.rows.length > 0) {
      return { backfillStarted: existingJob.rows[0].id }
    }

    const missingCount = await countApplicationRepositoriesMissingGithubRepoId()
    if (missingCount === 0) {
      return { backfillEmpty: true, backfillResult: { processed: 0, total: 0, fetched: 0, errors: 0 } }
    }

    let jobId: number
    try {
      const jobResult = await pool.query(
        `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at, result)
         VALUES ('backfill_github_repo_ids', $1, 'running', NOW(), $2, NOW() + INTERVAL '30 minutes', $3)
         RETURNING id`,
        [
          null,
          process.env.HOSTNAME || `local-${process.pid}`,
          JSON.stringify({ processed: 0, total: missingCount, fetched: 0, errors: 0 }),
        ],
      )
      jobId = jobResult.rows[0].id
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        const fallback = await pool.query(
          `SELECT id FROM sync_jobs WHERE job_type = 'backfill_github_repo_ids' AND monitored_app_id IS NULL AND status = 'running' LIMIT 1`,
        )
        if (fallback.rows.length > 0) return { backfillStarted: fallback.rows[0].id }
      }
      throw err
    }

    processBackfillGithubRepoIdsAsync(jobId).catch((err) => {
      logger.error('Backfill github_repo_id failed', err instanceof Error ? err : new Error(String(err)))
    })

    return { backfillStarted: jobId }
  }

  if (actionType === 'check_job_status') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) return { error: 'Mangler job_id' }
    const job = await getSyncJobById(jobId)
    return { jobStatus: job }
  }

  if (actionType === 'cancel_job') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) return { error: 'Mangler job_id' }
    const result = await pool.query(
      `UPDATE sync_jobs SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status = 'running'`,
      [jobId],
    )
    return { cancelled: (result.rowCount ?? 0) > 0 }
  }

  return null
}

async function processBackfillGithubRepoIdsAsync(jobId: number) {
  try {
    if (await isSyncJobCancelled(jobId)) return

    const result = await backfillGithubRepoIdsForAllRepositories({ jobId })
    const job = await getSyncJobById(jobId)
    if (job?.status === 'cancelled') return

    await pool.query(`UPDATE sync_jobs SET status = 'completed', completed_at = NOW(), result = $2 WHERE id = $1`, [
      jobId,
      JSON.stringify(result),
    ])
  } catch (err) {
    const job = await getSyncJobById(jobId)
    if (job?.status !== 'cancelled') {
      await pool.query(`UPDATE sync_jobs SET status = 'failed', completed_at = NOW(), error = $2 WHERE id = $1`, [
        jobId,
        err instanceof Error ? err.message : String(err),
      ])
    }
    throw err
  }
}

export default function GithubRepoIdsAdminPage() {
  const { missingCount, latestJob } = useLoaderData<typeof loader>()
  const revalidator = useRevalidator()

  const triggerFetcher = useFetcher()
  const pollFetcher = useFetcher()
  const cancelFetcher = useFetcher()

  const [activeJobId, setActiveJobId] = useState<number | null>(latestJob?.status === 'running' ? latestJob.id : null)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollFetcherRef = useRef(pollFetcher)
  pollFetcherRef.current = pollFetcher
  const revalidatorRef = useRef(revalidator)
  revalidatorRef.current = revalidator

  useEffect(() => {
    if (activeJobId) {
      pollInterval.current = setInterval(() => {
        pollFetcherRef.current.submit({ action: 'check_job_status', job_id: String(activeJobId) }, { method: 'post' })
      }, 2000)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          pollFetcherRef.current.submit({ action: 'check_job_status', job_id: String(activeJobId) }, { method: 'post' })
        }
      }
      document.addEventListener('visibilitychange', handleVisibilityChange)
      return () => {
        if (pollInterval.current) clearInterval(pollInterval.current)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current)
    }
  }, [activeJobId])

  const [progress, setProgress] = useState<GithubRepoIdBackfillResult | null>(() => {
    if (latestJob?.status === 'running' && latestJob.result) {
      const r = latestJob.result as Partial<GithubRepoIdBackfillResult>
      if (r.total != null) {
        return { processed: r.processed ?? 0, total: r.total, fetched: r.fetched ?? 0, errors: r.errors ?? 0 }
      }
    }
    return null
  })
  const [wasCancelled, setWasCancelled] = useState(false)

  useEffect(() => {
    const data = pollFetcher.data as
      | { jobStatus?: { status: string; result?: Partial<GithubRepoIdBackfillResult> } }
      | undefined
    if (data?.jobStatus) {
      const { status, result: jobResult } = data.jobStatus
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        setActiveJobId(null)
        if (pollInterval.current) clearInterval(pollInterval.current)
        if (status === 'cancelled') {
          setWasCancelled(true)
          setProgress(null)
        } else if (jobResult) {
          setProgress({
            processed: jobResult.processed ?? 0,
            total: jobResult.total ?? 0,
            fetched: jobResult.fetched ?? 0,
            errors: jobResult.errors ?? 0,
          })
        }
        revalidatorRef.current.revalidate()
      } else if (jobResult?.total != null) {
        setProgress({
          processed: jobResult.processed ?? 0,
          total: jobResult.total,
          fetched: jobResult.fetched ?? 0,
          errors: jobResult.errors ?? 0,
        })
      }
    }
  }, [pollFetcher.data])

  useEffect(() => {
    const data = triggerFetcher.data as
      | { backfillStarted?: number; backfillEmpty?: boolean; backfillResult?: GithubRepoIdBackfillResult }
      | undefined
    if (data?.backfillStarted) {
      setActiveJobId(data.backfillStarted)
      setProgress(null)
      setWasCancelled(false)
    } else if (data?.backfillEmpty) {
      setProgress(data.backfillResult ?? { processed: 0, total: 0, fetched: 0, errors: 0 })
      setWasCancelled(false)
      revalidator.revalidate()
    }
  }, [triggerFetcher.data, revalidator])

  useEffect(() => {
    const data = cancelFetcher.data as { cancelled?: boolean } | undefined
    if (data?.cancelled) {
      setActiveJobId(null)
      setProgress(null)
      setWasCancelled(true)
      if (pollInterval.current) clearInterval(pollInterval.current)
      revalidatorRef.current.revalidate()
    }
  }, [cancelFetcher.data])

  const isRunning = !!activeJobId || triggerFetcher.state !== 'idle'

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          GitHub repo-ID (alle repoer)
        </Heading>
        <BodyShort textColor="subtle">
          Hent GitHub&apos;s stabile, endringssikre repo-ID for alle registrerte repoer. Brukes som nøkkel for
          monorepo-verifisering, siden owner/repo-navn kan endres.
        </BodyShort>
      </div>

      <Box background={missingCount > 0 ? 'warning-soft' : 'success-soft'} padding="space-16" borderRadius="8">
        <VStack gap="space-8">
          <HStack gap="space-16" align="center" justify="space-between">
            <BodyShort>
              {missingCount > 0 ? '⚠️ ' : '✅ '}
              {missingCount === 0
                ? 'Alle repoer har registrert github_repo_id.'
                : missingCount === 1
                  ? '1 repo mangler github_repo_id.'
                  : `${missingCount} repoer mangler github_repo_id.`}
            </BodyShort>
            {missingCount > 0 && (
              <triggerFetcher.Form method="post">
                <input type="hidden" name="action" value="backfill_all" />
                <Button type="submit" size="small" variant="secondary" loading={isRunning}>
                  {isRunning ? 'Henter…' : `Hent for alle (${missingCount})`}
                </Button>
              </triggerFetcher.Form>
            )}
            {activeJobId && (
              <cancelFetcher.Form method="post">
                <input type="hidden" name="action" value="cancel_job" />
                <input type="hidden" name="job_id" value={activeJobId} />
                <Button type="submit" size="small" variant="danger">
                  Stopp
                </Button>
              </cancelFetcher.Form>
            )}
          </HStack>

          {isRunning && (
            <HStack gap="space-8" align="center">
              <Loader size="xsmall" title="Henter GitHub repo-ID-er" />
              <Detail>
                {progress
                  ? `${progress.processed} av ${progress.total}${progress.fetched > 0 ? ` — ${progress.fetched} hentet` : ''}${progress.errors > 0 ? ` — ${progress.errors} feil` : ''}…`
                  : 'Starter…'}
              </Detail>
            </HStack>
          )}

          {!activeJobId && wasCancelled && (
            <Alert variant="info" size="small">
              Datahenting avbrutt.
            </Alert>
          )}

          {!activeJobId && !wasCancelled && progress && (
            <Alert variant={progress.errors > 0 ? 'warning' : 'success'} size="small">
              Datahenting fullført: {progress.fetched} hentet
              {progress.errors > 0 && `, ${progress.errors} feil`}.
            </Alert>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
