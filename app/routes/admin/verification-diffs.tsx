/**
 * Global Verification Diffs Admin Page
 *
 * Allows admins to compute and view verification diffs across ALL
 * monitored applications, not just one at a time.
 */

import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  Detail,
  Heading,
  HStack,
  Loader,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher, useLoaderData, useNavigation, useRevalidator } from 'react-router'
import { ErrorReasonWithLink } from '~/components/ErrorReasonWithLink'
import { pool } from '~/db/connection.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getSyncJobById } from '~/db/sync-jobs.server'
import { getAllApprovedDeploymentsMissingApprover } from '~/db/verification-diff.server'
import { requireAdmin } from '~/lib/auth.server'
import {
  type FourEyesStatus,
  getFourEyesStatusLabel,
  isApprovedStatus,
  isProtectedStatus,
} from '~/lib/four-eyes-status'
import { isValidCommitSha } from '~/lib/git-constants'
import { logger } from '~/lib/logger.server'
import { reverifyDeployment, runVerification } from '~/lib/verification'
import { computeVerificationDiffs } from '~/lib/verification/compute-diffs.server'
import type { Route } from './+types/verification-diffs'

interface DiffWithApp {
  id: number
  commitSha: string
  environmentName: string
  createdAt: string
  oldStatus: string | null
  newStatus: string
  errorReason: string | null
  teamSlug: string
  appName: string
  monitoredAppId: number
  githubOwner: string | null
  githubRepoName: string | null
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiseringsavvik (alle apper) - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  // Get all diffs across all apps
  const result = await pool.query(
    `SELECT vd.deployment_id, vd.old_status, vd.new_status, vd.error_reason, vd.monitored_app_id,
            d.commit_sha, d.environment_name, d.created_at,
            d.team_slug, d.app_name,
            d.detected_github_owner, d.detected_github_repo_name
     FROM verification_diffs vd
     JOIN deployments d ON vd.deployment_id = d.id
     ORDER BY d.team_slug, d.app_name, d.created_at DESC`,
  )

  const diffs: DiffWithApp[] = result.rows.map(
    (row: {
      deployment_id: number
      commit_sha: string
      environment_name: string
      created_at: Date
      old_status: string | null
      new_status: string
      error_reason: string | null
      team_slug: string
      app_name: string
      monitored_app_id: number
      detected_github_owner: string | null
      detected_github_repo_name: string | null
    }) => ({
      id: row.deployment_id,
      commitSha: row.commit_sha,
      environmentName: row.environment_name,
      createdAt: row.created_at.toISOString(),
      oldStatus: row.old_status,
      newStatus: row.new_status,
      errorReason: row.error_reason,
      teamSlug: row.team_slug,
      appName: row.app_name,
      monitoredAppId: row.monitored_app_id,
      githubOwner: row.detected_github_owner,
      githubRepoName: row.detected_github_repo_name,
    }),
  )

  // Get all active apps for the compute-all button
  const apps = await getAllMonitoredApplications()

  // Get latest global compute job
  const jobResult = await pool.query(
    `SELECT id, status, result, started_at, completed_at
     FROM sync_jobs
     WHERE job_type = 'reverify_all'
     ORDER BY created_at DESC
     LIMIT 1`,
  )
  const latestJob = jobResult.rows[0] || null

  // Get missing approver deployments across all apps
  const missingApproverRows = await getAllApprovedDeploymentsMissingApprover()
  const missingApproverCount = missingApproverRows.length

  // Group missing approver by app for summary
  const missingApproverByApp = new Map<string, number>()
  for (const row of missingApproverRows) {
    const key = `${row.team_slug}/${row.app_name}`
    missingApproverByApp.set(key, (missingApproverByApp.get(key) || 0) + 1)
  }
  const missingApproverApps = [...missingApproverByApp.entries()].map(([app, count]) => ({ app, count }))

  // Get latest refresh job
  const refreshJobResult = await pool.query(
    `SELECT id, status, result, started_at, completed_at
     FROM sync_jobs
     WHERE job_type = 'refresh_missing_approver'
     ORDER BY created_at DESC
     LIMIT 1`,
  )
  const latestRefreshJob = refreshJobResult.rows[0] || null

  return { diffs, appCount: apps.length, latestJob, missingApproverCount, missingApproverApps, latestRefreshJob }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const actionType = formData.get('action') as string

  if (actionType === 'compute_all') {
    // Start computing diffs for all apps in background
    const apps = await getAllMonitoredApplications()

    // Create a tracking job
    const jobResult = await pool.query(
      `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at, result)
       VALUES ('reverify_all', $1, 'running', NOW(), $2, NOW() + INTERVAL '30 minutes', $3)
       RETURNING id`,
      [
        apps[0]?.id || 1,
        `pod-${process.env.HOSTNAME || 'local'}`,
        JSON.stringify({ processed: 0, total: apps.length, totalDiffs: 0 }),
      ],
    )
    const jobId = jobResult.rows[0].id

    // Process in background
    processComputeAllAsync(jobId, apps).catch((err) => {
      logger.error('Compute all diffs failed', err instanceof Error ? err : new Error(String(err)))
    })

    return { computeAllStarted: jobId }
  }

  if (actionType === 'check_job_status') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) return { error: 'Mangler job_id' }
    const job = await getSyncJobById(jobId)
    return { jobStatus: job }
  }

  if (actionType === 'apply_selected') {
    const ids = formData.getAll('deployment_ids').map((id) => parseInt(id as string, 10))
    let applied = 0
    let skipped = 0
    let errors = 0

    for (const id of ids) {
      try {
        const result = await reverifyDeployment(id)
        if (result?.changed) {
          await pool.query('DELETE FROM verification_diffs WHERE deployment_id = $1', [id])
          applied++
        } else {
          skipped++
        }
      } catch (err) {
        logger.error(`Reverification failed for deployment ${id}`, err instanceof Error ? err : new Error(String(err)))
        errors++
      }
    }

    return { appliedAll: true, applied, skipped, errors }
  }

  if (actionType === 'refresh_missing_approver_all') {
    // Check for existing running job BEFORE heavy query
    const existingJob = await pool.query(
      `SELECT id FROM sync_jobs WHERE job_type = 'refresh_missing_approver' AND monitored_app_id IS NULL AND status = 'running' LIMIT 1`,
    )
    if (existingJob.rows.length > 0) {
      return { refreshStarted: existingJob.rows[0].id }
    }

    const deployments = await getAllApprovedDeploymentsMissingApprover()
    if (deployments.length === 0)
      return { refreshEmpty: true, refreshResult: { refreshed: 0, skipped: 0, errors: 0, total: 0 } }

    // Create a tracking job — handle unique constraint race (23505)
    let jobId: number
    try {
      const jobResult = await pool.query(
        `INSERT INTO sync_jobs (job_type, monitored_app_id, status, started_at, locked_by, lock_expires_at, result)
         VALUES ('refresh_missing_approver', $1, 'running', NOW(), $2, NOW() + INTERVAL '30 minutes', $3)
         RETURNING id`,
        [
          null,
          `pod-${process.env.HOSTNAME || 'local'}`,
          JSON.stringify({ processed: 0, refreshed: 0, skipped: 0, errors: 0, total: deployments.length }),
        ],
      )
      jobId = jobResult.rows[0].id
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        const fallback = await pool.query(
          `SELECT id FROM sync_jobs WHERE job_type = 'refresh_missing_approver' AND monitored_app_id IS NULL AND status = 'running' LIMIT 1`,
        )
        if (fallback.rows.length > 0) return { refreshStarted: fallback.rows[0].id }
      }
      throw err
    }

    processRefreshMissingApproverAsync(jobId, deployments).catch((err) => {
      logger.error('Refresh missing approver failed', err instanceof Error ? err : new Error(String(err)))
    })

    return { refreshStarted: jobId }
  }

  return null
}

async function processComputeAllAsync(jobId: number, apps: Array<{ id: number; team_slug: string; app_name: string }>) {
  let processed = 0
  let totalDiffs = 0
  let errors = 0

  try {
    for (const app of apps) {
      try {
        const result = await computeVerificationDiffs(app.id)
        totalDiffs += result.diffsFound
      } catch (err) {
        logger.error(
          `Compute diffs failed for ${app.team_slug}/${app.app_name}`,
          err instanceof Error ? err : new Error(String(err)),
        )
        errors++
      }
      processed++

      // Update progress
      await pool.query(`UPDATE sync_jobs SET result = $2 WHERE id = $1 AND status = 'running'`, [
        jobId,
        JSON.stringify({ processed, total: apps.length, totalDiffs, errors }),
      ])

      // Extend lock
      if (processed % 5 === 0) {
        await pool.query(
          `UPDATE sync_jobs SET lock_expires_at = NOW() + INTERVAL '30 minutes' WHERE id = $1 AND status = 'running'`,
          [jobId],
        )
      }
    }

    await pool.query(`UPDATE sync_jobs SET status = 'completed', completed_at = NOW(), result = $2 WHERE id = $1`, [
      jobId,
      JSON.stringify({ processed, total: apps.length, totalDiffs, errors }),
    ])
  } catch (err) {
    await pool.query(`UPDATE sync_jobs SET status = 'failed', completed_at = NOW(), error = $2 WHERE id = $1`, [
      jobId,
      err instanceof Error ? err.message : String(err),
    ])
    throw err
  }
}

interface RefreshableDeployment {
  id: number
  commit_sha: string | null
  four_eyes_status: string
  environment_name: string
  detected_github_owner: string | null
  detected_github_repo_name: string | null
  monitored_app_id: number
  default_branch: string | null
}

async function processRefreshMissingApproverAsync(jobId: number, deployments: RefreshableDeployment[]) {
  let refreshed = 0
  let skipped = 0
  let errors = 0

  try {
    for (const dep of deployments) {
      if (
        !dep.commit_sha ||
        !dep.detected_github_owner ||
        !dep.detected_github_repo_name ||
        isProtectedStatus(dep.four_eyes_status) ||
        !isValidCommitSha(dep.commit_sha)
      ) {
        skipped++
      } else {
        try {
          await runVerification(dep.id, {
            commitSha: dep.commit_sha,
            repository: `${dep.detected_github_owner}/${dep.detected_github_repo_name}`,
            environmentName: dep.environment_name,
            baseBranch: dep.default_branch || 'main',
            monitoredAppId: dep.monitored_app_id,
            forceRefresh: true,
          })
          await pool.query('DELETE FROM verification_diffs WHERE deployment_id = $1', [dep.id])
          refreshed++
        } catch (err) {
          logger.error(
            `Refresh verification failed for deployment ${dep.id}`,
            err instanceof Error ? err : new Error(String(err)),
          )
          errors++
        }
      }

      const processed = refreshed + skipped + errors

      // Update progress and extend lock every 5 deployments
      if (processed % 5 === 0) {
        await pool.query(
          `UPDATE sync_jobs SET result = $2, lock_expires_at = NOW() + INTERVAL '30 minutes' WHERE id = $1 AND status = 'running'`,
          [jobId, JSON.stringify({ processed, refreshed, skipped, errors, total: deployments.length })],
        )
      }
    }

    await pool.query(`UPDATE sync_jobs SET status = 'completed', completed_at = NOW(), result = $2 WHERE id = $1`, [
      jobId,
      JSON.stringify({
        processed: refreshed + skipped + errors,
        refreshed,
        skipped,
        errors,
        total: deployments.length,
      }),
    ])
  } catch (err) {
    await pool.query(`UPDATE sync_jobs SET status = 'failed', completed_at = NOW(), error = $2 WHERE id = $1`, [
      jobId,
      err instanceof Error ? err.message : String(err),
    ])
    throw err
  }
}

export default function GlobalVerificationDiffsPage() {
  const { diffs, appCount, latestJob, missingApproverCount, missingApproverApps, latestRefreshJob } =
    useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const isApplying = navigation.state === 'submitting' && navigation.formData?.get('action') === 'apply_selected'

  // Job polling
  const computeFetcher = useFetcher()
  const [activeJobId, setActiveJobId] = useState<number | null>(latestJob?.status === 'running' ? latestJob.id : null)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const computeFetcherRef = useRef(computeFetcher)
  computeFetcherRef.current = computeFetcher
  const revalidatorRef = useRef(revalidator)
  revalidatorRef.current = revalidator

  useEffect(() => {
    if (activeJobId) {
      pollInterval.current = setInterval(() => {
        computeFetcherRef.current.submit(
          { action: 'check_job_status', job_id: String(activeJobId) },
          { method: 'post' },
        )
      }, 2000)
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current)
    }
  }, [activeJobId])

  const [jobProgress, setJobProgress] = useState<{
    processed: number
    total: number
    totalDiffs: number
  } | null>(null)

  useEffect(() => {
    const data = computeFetcher.data as
      | {
          jobStatus?: {
            status: string
            result?: { processed?: number; total?: number; totalDiffs?: number }
          }
        }
      | undefined
    if (data?.jobStatus) {
      const { status, result: jobResult } = data.jobStatus
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        setActiveJobId(null)
        setJobProgress(null)
        if (pollInterval.current) clearInterval(pollInterval.current)
        revalidatorRef.current.revalidate()
      } else if (jobResult?.processed != null && jobResult?.total != null) {
        setJobProgress({
          processed: jobResult.processed,
          total: jobResult.total,
          totalDiffs: jobResult.totalDiffs ?? 0,
        })
      }
    }
  }, [computeFetcher.data])

  const triggerFetcher = useFetcher()
  useEffect(() => {
    const data = triggerFetcher.data as { computeAllStarted?: number } | undefined
    if (data?.computeAllStarted) {
      setActiveJobId(data.computeAllStarted)
    }
  }, [triggerFetcher.data])

  const isComputing = !!activeJobId || triggerFetcher.state !== 'idle'

  // Refresh missing approver job polling
  const refreshFetcher = useFetcher()
  const refreshTriggerFetcher = useFetcher()
  const [activeRefreshJobId, setActiveRefreshJobId] = useState<number | null>(
    latestRefreshJob?.status === 'running' ? latestRefreshJob.id : null,
  )
  const refreshPollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const refreshFetcherRef = useRef(refreshFetcher)
  refreshFetcherRef.current = refreshFetcher

  useEffect(() => {
    if (activeRefreshJobId) {
      refreshPollInterval.current = setInterval(() => {
        refreshFetcherRef.current.submit(
          { action: 'check_job_status', job_id: String(activeRefreshJobId) },
          { method: 'post' },
        )
      }, 3000)
    }
    return () => {
      if (refreshPollInterval.current) clearInterval(refreshPollInterval.current)
    }
  }, [activeRefreshJobId])

  const [refreshProgress, setRefreshProgress] = useState<{
    refreshed: number
    skipped: number
    errors: number
    total: number
  } | null>(null)

  useEffect(() => {
    const data = refreshFetcher.data as
      | {
          jobStatus?: {
            status: string
            result?: { refreshed?: number; skipped?: number; errors?: number; total?: number }
          }
        }
      | undefined
    if (data?.jobStatus) {
      const { status, result: jobResult } = data.jobStatus
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        setActiveRefreshJobId(null)
        if (refreshPollInterval.current) clearInterval(refreshPollInterval.current)
        if (jobResult) {
          setRefreshProgress({
            refreshed: jobResult.refreshed ?? 0,
            skipped: jobResult.skipped ?? 0,
            errors: jobResult.errors ?? 0,
            total: jobResult.total ?? 0,
          })
        }
        revalidatorRef.current.revalidate()
      } else if (jobResult?.total != null) {
        setRefreshProgress({
          refreshed: jobResult.refreshed ?? 0,
          skipped: jobResult.skipped ?? 0,
          errors: jobResult.errors ?? 0,
          total: jobResult.total,
        })
      }
    }
  }, [refreshFetcher.data])

  useEffect(() => {
    const data = refreshTriggerFetcher.data as
      | { refreshStarted?: number; refreshEmpty?: boolean; refreshResult?: { refreshed: number } }
      | undefined
    if (data?.refreshStarted) {
      setActiveRefreshJobId(data.refreshStarted)
      setRefreshProgress(null)
    } else if (data?.refreshEmpty) {
      setRefreshProgress({ refreshed: 0, skipped: 0, errors: 0, total: 0 })
    }
  }, [refreshTriggerFetcher.data])

  const isRefreshing = !!activeRefreshJobId || refreshTriggerFetcher.state !== 'idle'

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const toggleId = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const toggleAll = () => {
    setSelectedIds((prev) => (prev.length === diffs.length ? [] : diffs.map((d) => d.id)))
  }
  const prevDiffCount = useRef(diffs.length)
  useEffect(() => {
    if (diffs.length !== prevDiffCount.current) {
      setSelectedIds([])
      prevDiffCount.current = diffs.length
    }
  })

  // Group diffs by app for summary
  const appGroups = new Map<string, number>()
  for (const diff of diffs) {
    const key = `${diff.teamSlug}/${diff.appName}`
    appGroups.set(key, (appGroups.get(key) || 0) + 1)
  }

  const lastComputed =
    latestJob?.status === 'completed' && latestJob.completed_at
      ? new Date(latestJob.completed_at).toLocaleString('no-NO')
      : null

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Verifiseringsavvik
        </Heading>
        <BodyShort textColor="subtle">
          Avvik mellom lagret og ny verifisering for alle {appCount} applikasjoner.
        </BodyShort>
      </div>

      {/* Compute trigger */}
      <Box background="neutral-soft" padding="space-16" borderRadius="8">
        <HStack gap="space-16" align="center" justify="space-between">
          <VStack gap="space-4">
            {lastComputed ? (
              <Detail>Sist beregnet: {lastComputed}</Detail>
            ) : (
              <Detail>Avvik er ikke beregnet ennå.</Detail>
            )}
          </VStack>
          <triggerFetcher.Form method="post">
            <input type="hidden" name="action" value="compute_all" />
            <Button type="submit" size="small" variant="secondary" loading={isComputing}>
              {isComputing ? 'Beregner…' : `Beregn avvik for alle (${appCount} apper)`}
            </Button>
          </triggerFetcher.Form>
        </HStack>
        {isComputing && (
          <Box marginBlock="space-8 space-0">
            <HStack gap="space-8" align="center">
              <Loader size="xsmall" />
              <Detail>
                {jobProgress
                  ? `App ${jobProgress.processed} av ${jobProgress.total}${jobProgress.totalDiffs > 0 ? ` — ${jobProgress.totalDiffs} avvik funnet` : ''}…`
                  : 'Starter beregning…'}
              </Detail>
            </HStack>
          </Box>
        )}
      </Box>

      {/* Missing approver section */}
      {(missingApproverCount > 0 || (refreshProgress && !activeRefreshJobId)) && (
        <Box background="danger-soft" padding="space-16" borderRadius="8">
          <VStack gap="space-8">
            <HStack gap="space-16" align="center" justify="space-between">
              <BodyShort>
                ⚠️{' '}
                {missingApproverCount === 0
                  ? 'Ingen deployments mangler godkjenner-data.'
                  : missingApproverCount === 1
                    ? '1 godkjent deployment mangler godkjenner-data.'
                    : `${missingApproverCount} godkjente deployments mangler godkjenner-data.`}
                {missingApproverApps.length > 0 &&
                  ` (${missingApproverApps.map((a) => `${a.app}: ${a.count}`).join(', ')})`}
              </BodyShort>
              {missingApproverCount > 0 && (
                <refreshTriggerFetcher.Form method="post">
                  <input type="hidden" name="action" value="refresh_missing_approver_all" />
                  <Button type="submit" size="small" variant="secondary" loading={isRefreshing}>
                    {isRefreshing ? 'Re-verifiserer…' : `Re-verifiser alle (${missingApproverCount})`}
                  </Button>
                </refreshTriggerFetcher.Form>
              )}
            </HStack>
            {isRefreshing && refreshProgress && (
              <HStack gap="space-8" align="center">
                <Loader size="xsmall" />
                <Detail>
                  {refreshProgress.refreshed + refreshProgress.skipped + refreshProgress.errors} av{' '}
                  {refreshProgress.total}
                  {refreshProgress.refreshed > 0 && ` — ${refreshProgress.refreshed} oppdatert`}
                  {refreshProgress.errors > 0 && ` — ${refreshProgress.errors} feil`}…
                </Detail>
              </HStack>
            )}
            {!activeRefreshJobId && refreshProgress && (
              <Alert variant={refreshProgress.errors > 0 ? 'warning' : 'success'} size="small">
                Re-verifisering fullført: {refreshProgress.refreshed} oppdatert, {refreshProgress.skipped} hoppet over
                {refreshProgress.errors > 0 && `, ${refreshProgress.errors} feil`}.
              </Alert>
            )}
          </VStack>
        </Box>
      )}
      {diffs.length === 0 && lastComputed ? (
        <Alert variant="success" size="small">
          Ingen avvik funnet.
        </Alert>
      ) : diffs.length > 0 ? (
        <Alert variant="warning" size="small">
          {diffs.length} avvik funnet i {appGroups.size} app(er):{' '}
          {[...appGroups.entries()].map(([app, count]) => `${app} (${count})`).join(', ')}
        </Alert>
      ) : null}

      {/* Diffs table */}
      {diffs.length > 0 && (
        <VStack gap="space-16">
          <Form method="post">
            <input type="hidden" name="action" value="apply_selected" />
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="deployment_ids" value={id} />
            ))}
            <Button
              type="submit"
              size="small"
              variant="secondary"
              loading={isApplying}
              disabled={selectedIds.length === 0}
            >
              Oppdater valgte ({selectedIds.length})
            </Button>
          </Form>

          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell style={{ width: '1%' }}>
                  <Checkbox
                    checked={selectedIds.length === diffs.length}
                    indeterminate={selectedIds.length > 0 && selectedIds.length < diffs.length}
                    onChange={toggleAll}
                    hideLabel
                    size="small"
                  >
                    Velg alle
                  </Checkbox>
                </Table.HeaderCell>
                <Table.HeaderCell>App</Table.HeaderCell>
                <Table.HeaderCell>Commit</Table.HeaderCell>
                <Table.HeaderCell>Miljø</Table.HeaderCell>
                <Table.HeaderCell>Dato</Table.HeaderCell>
                <Table.HeaderCell>Gammel</Table.HeaderCell>
                <Table.HeaderCell>Ny</Table.HeaderCell>
                <Table.HeaderCell>Four eyes</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {diffs.map((diff) => (
                <Table.Row key={diff.id} selected={selectedIds.includes(diff.id)}>
                  <Table.DataCell>
                    <Checkbox
                      checked={selectedIds.includes(diff.id)}
                      onChange={() => toggleId(diff.id)}
                      hideLabel
                      size="small"
                    >
                      Velg {diff.id}
                    </Checkbox>
                  </Table.DataCell>
                  <Table.DataCell>
                    <AkselLink
                      as={Link}
                      to={`/team/${diff.teamSlug}/env/${diff.environmentName}/app/${diff.appName}/admin/verification-diff`}
                    >
                      {diff.appName}
                    </AkselLink>
                  </Table.DataCell>
                  <Table.DataCell>
                    <AkselLink as={Link} to={`/deployments/${diff.id}`}>
                      {diff.commitSha.substring(0, 7)}
                    </AkselLink>
                  </Table.DataCell>
                  <Table.DataCell>{diff.environmentName}</Table.DataCell>
                  <Table.DataCell>{new Date(diff.createdAt).toLocaleDateString('no-NO')}</Table.DataCell>
                  <Table.DataCell>
                    <Tag variant="neutral" size="xsmall">
                      {getFourEyesStatusLabel(diff.oldStatus || 'null')}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    <Tag variant={diff.newStatus === 'error' ? 'warning' : 'info'} size="xsmall">
                      {getFourEyesStatusLabel(diff.newStatus)}
                    </Tag>
                    {diff.errorReason && (
                      <ErrorReasonWithLink
                        errorReason={diff.errorReason}
                        githubOwner={diff.githubOwner}
                        githubRepoName={diff.githubRepoName}
                      />
                    )}
                  </Table.DataCell>
                  <Table.DataCell>
                    {(() => {
                      const oldApproved = diff.oldStatus ? isApprovedStatus(diff.oldStatus as FourEyesStatus) : false
                      const newApproved = isApprovedStatus(diff.newStatus as FourEyesStatus)
                      return oldApproved !== newApproved ? (
                        <Tag variant="warning" size="xsmall">
                          {String(oldApproved)} → {String(newApproved)}
                        </Tag>
                      ) : null
                    })()}
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </VStack>
      )}
    </VStack>
  )
}
