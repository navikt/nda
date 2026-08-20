import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Loader, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { useFetcher, useLoaderData, useRevalidator } from 'react-router'
import { pool } from '~/db/connection.server'
import { getSyncJobById, isSyncJobCancelled, releaseExpiredLocks } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import {
  backfillWorkflowTriggerConfigForAllApps,
  countDeploymentsMissingWorkflowTriggerConfig,
  type WorkflowTriggerBackfillResult,
} from '~/lib/verification'
import type { Route } from './+types/workflow-triggers'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Workflow-triggere (alle apper) - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const missingCount = await countDeploymentsMissingWorkflowTriggerConfig()

  const jobResult = await pool.query(
    `SELECT id, status, result, started_at, completed_at
     FROM sync_jobs
     WHERE job_type = 'backfill_workflow_triggers' AND monitored_app_id IS NULL
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
      `SELECT id FROM sync_jobs WHERE job_type = 'backfill_workflow_triggers' AND monitored_app_id IS NULL AND status = 'running' LIMIT 1`,
    )
    if (existingJob.rows.length > 0) {
      return { backfillStarted: existingJob.rows[0].id }
    }

    const missingCount = await countDeploymentsMissingWorkflowTriggerConfig()
    if (missingCount === 0) {
      return { backfillEmpty: true, backfillResult: { processed: 0, total: 0, fetched: 0, errors: 0 } }
    }

    let jobId: number
    try {
      const jobResult = await pool.query(
        `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at, result)
         VALUES ('backfill_workflow_triggers', $1, 'running', NOW(), $2, NOW() + INTERVAL '30 minutes', $3)
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
          `SELECT id FROM sync_jobs WHERE job_type = 'backfill_workflow_triggers' AND monitored_app_id IS NULL AND status = 'running' LIMIT 1`,
        )
        if (fallback.rows.length > 0) return { backfillStarted: fallback.rows[0].id }
      }
      throw err
    }

    processBackfillWorkflowTriggersAsync(jobId).catch((err) => {
      logger.error('Backfill workflow triggers failed', err instanceof Error ? err : new Error(String(err)))
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
    await pool.query(
      `UPDATE sync_jobs SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status = 'running'`,
      [jobId],
    )
    return { cancelled: true }
  }

  return null
}

async function processBackfillWorkflowTriggersAsync(jobId: number) {
  try {
    if (await isSyncJobCancelled(jobId)) return

    const result = await backfillWorkflowTriggerConfigForAllApps({ jobId })
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

export default function WorkflowTriggersAdminPage() {
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
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current)
    }
  }, [activeJobId])

  const [progress, setProgress] = useState<WorkflowTriggerBackfillResult | null>(() => {
    if (latestJob?.status === 'running' && latestJob.result) {
      const r = latestJob.result as Partial<WorkflowTriggerBackfillResult>
      if (r.total != null) {
        return { processed: r.processed ?? 0, total: r.total, fetched: r.fetched ?? 0, errors: r.errors ?? 0 }
      }
    }
    return null
  })

  useEffect(() => {
    const data = pollFetcher.data as
      | { jobStatus?: { status: string; result?: Partial<WorkflowTriggerBackfillResult> } }
      | undefined
    if (data?.jobStatus) {
      const { status, result: jobResult } = data.jobStatus
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        setActiveJobId(null)
        if (pollInterval.current) clearInterval(pollInterval.current)
        if (jobResult) {
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
      | { backfillStarted?: number; backfillEmpty?: boolean; backfillResult?: WorkflowTriggerBackfillResult }
      | undefined
    if (data?.backfillStarted) {
      setActiveJobId(data.backfillStarted)
      setProgress(null)
    } else if (data?.backfillEmpty) {
      setProgress(data.backfillResult ?? { processed: 0, total: 0, fetched: 0, errors: 0 })
      revalidator.revalidate()
    }
  }, [triggerFetcher.data, revalidator])

  const isRunning = !!activeJobId || triggerFetcher.state !== 'idle'

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Workflow-triggere (alle apper)
        </Heading>
        <BodyShort textColor="subtle">
          Hent manglende eller utdatert informasjon om hvordan deployments ble startet (trigger-type og workflow-fil)
          fra GitHub, for alle applikasjoner samlet.
        </BodyShort>
      </div>

      <Box background={missingCount > 0 ? 'warning-soft' : 'success-soft'} padding="space-16" borderRadius="8">
        <VStack gap="space-8">
          <HStack gap="space-16" align="center" justify="space-between">
            <BodyShort>
              {missingCount > 0 ? '⚠️ ' : '✅ '}
              {missingCount === 0
                ? 'Alle deployments har oppdatert trigger-informasjon.'
                : missingCount === 1
                  ? '1 deployment mangler eller har utdatert trigger-informasjon.'
                  : `${missingCount} deployments mangler eller har utdatert trigger-informasjon.`}
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
              <Loader size="xsmall" />
              <Detail>
                {progress
                  ? `${progress.processed} av ${progress.total}${progress.fetched > 0 ? ` — ${progress.fetched} hentet` : ''}${progress.errors > 0 ? ` — ${progress.errors} feil` : ''}…`
                  : 'Starter…'}
              </Detail>
            </HStack>
          )}

          {!activeJobId && progress && (
            <Alert variant={progress.errors > 0 ? 'warning' : 'success'} size="small">
              Datahenting fullført: {progress.fetched} hentet, {progress.processed - progress.fetched - progress.errors}{' '}
              uendret
              {progress.errors > 0 && `, ${progress.errors} feil`}.
            </Alert>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
