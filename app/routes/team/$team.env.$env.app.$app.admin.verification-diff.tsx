/**
 * Verification Diff Page (App-specific)
 *
 * Shows pre-computed differences between stored verification status and
 * what V2 verification would produce. Diffs are computed by the
 * reverify_app sync job and stored in the verification_diffs table.
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
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getLatestSyncJob, getSyncJobById } from '~/db/sync-jobs.server'
import { getApprovedDeploymentsMissingApprover } from '~/db/verification-diff.server'
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
import type { Route } from './+types/$team.env.$env.app.$app.admin.verification-diff'

interface DeploymentDiff {
  id: number
  commitSha: string
  environmentName: string
  createdAt: string
  oldStatus: string | null
  newStatus: string
  errorReason: string | null
  githubOwner: string | null
  githubRepoName: string | null
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { team, env, app } = params

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, app)
  if (!monitoredApp) {
    return { diffs: [], missingApproverDeployments: [], appContext: null, lastComputed: null, latestJob: null }
  }

  const appContext = {
    teamSlug: monitoredApp.team_slug,
    environmentName: monitoredApp.environment_name,
    appName: monitoredApp.app_name,
    monitoredAppId: monitoredApp.id,
  }

  // Read pre-computed diffs from database
  const result = await pool.query(
    `SELECT vd.deployment_id, vd.old_status, vd.new_status, vd.error_reason,
            vd.computed_at,
            d.commit_sha, d.environment_name, d.created_at,
            d.detected_github_owner, d.detected_github_repo_name
     FROM verification_diffs vd
     JOIN deployments d ON vd.deployment_id = d.id
     WHERE vd.monitored_app_id = $1
     ORDER BY d.created_at DESC`,
    [monitoredApp.id],
  )

  const diffs: DeploymentDiff[] = result.rows.map((row) => ({
    id: row.deployment_id,
    commitSha: row.commit_sha,
    environmentName: row.environment_name,
    createdAt: row.created_at.toISOString(),
    oldStatus: row.old_status,
    newStatus: row.new_status,
    errorReason: row.error_reason,
    githubOwner: row.detected_github_owner,
    githubRepoName: row.detected_github_repo_name,
  }))

  // Get last computation time from the latest completed job, not from diffs
  const [latestJob, missingApproverRows] = await Promise.all([
    getLatestSyncJob(monitoredApp.id, 'reverify_app'),
    getApprovedDeploymentsMissingApprover(monitoredApp.id),
  ])
  const lastComputed =
    latestJob?.status === 'completed' && latestJob.completed_at ? new Date(latestJob.completed_at).toISOString() : null

  const missingApproverDeployments = missingApproverRows.map((row) => ({
    id: row.id,
    commitSha: row.commit_sha,
    fourEyesStatus: row.four_eyes_status,
    environmentName: row.environment_name,
    createdAt: row.created_at.toISOString(),
    deployerUsername: row.deployer_username,
  }))

  return { diffs, missingApproverDeployments, appContext, lastComputed, latestJob }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireAdmin(request)

  const { team, env, app } = params

  const formData = await request.formData()
  const actionType = formData.get('action') as string
  const deploymentId = parseInt(formData.get('deployment_id') as string, 10)

  if (actionType === 'apply_reverification' && deploymentId) {
    try {
      const result = await reverifyDeployment(deploymentId)
      if (!result) {
        return { error: `Deployment ${deploymentId} ble hoppet over (manuelt godkjent, legacy, eller mangler data)` }
      }
      if (result.changed) {
        // Remove the diff row since we've applied the change
        await pool.query('DELETE FROM verification_diffs WHERE deployment_id = $1', [deploymentId])
        return {
          applied: deploymentId,
          message: `Oppdatert: ${result.oldStatus} → ${result.newStatus}`,
        }
      }
      return { applied: deploymentId, message: 'Ingen endring nødvendig' }
    } catch (err) {
      logger.error(
        `Reverification failed for deployment ${deploymentId}`,
        err instanceof Error ? err : new Error(String(err)),
      )
      return {
        error: `Feil ved re-verifisering av deployment ${deploymentId}: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  if (actionType === 'apply_all') {
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

  if (actionType === 'check_compute_status') {
    const jobId = parseInt(formData.get('job_id') as string, 10)
    if (!jobId) return { error: 'Mangler job_id' }
    const job = await getSyncJobById(jobId)
    return { computeJobStatus: job }
  }

  if (actionType === 'refresh_missing_approver') {
    const monitoredApp = await getMonitoredApplicationByIdentity(team, env, app)
    if (!monitoredApp) return { error: 'App ikke funnet' }

    const deployments = await getApprovedDeploymentsMissingApprover(monitoredApp.id)
    if (deployments.length === 0) return { refreshResult: { refreshed: 0, skipped: 0, errors: 0 } }

    let refreshed = 0
    let skipped = 0
    let errors = 0

    for (const dep of deployments) {
      if (
        !dep.commit_sha ||
        !dep.detected_github_owner ||
        !dep.detected_github_repo_name ||
        isProtectedStatus(dep.four_eyes_status) ||
        !isValidCommitSha(dep.commit_sha)
      ) {
        skipped++
        continue
      }
      try {
        await runVerification(dep.id, {
          commitSha: dep.commit_sha,
          repository: `${dep.detected_github_owner}/${dep.detected_github_repo_name}`,
          environmentName: dep.environment_name,
          baseBranch: dep.default_branch || 'main',
          monitoredAppId: monitoredApp.id,
          forceRefresh: true,
        })
        // Remove stale verification_diffs row if it exists
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

    return { refreshResult: { refreshed, skipped, errors } }
  }

  return null
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiseringsavvik' }]
}

export default function VerificationDiffPage() {
  const { diffs, missingApproverDeployments, appContext, lastComputed, latestJob } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const submittingId = navigation.state === 'submitting' ? navigation.formData?.get('deployment_id')?.toString() : null
  const isApplyingAll = navigation.state === 'submitting' && navigation.formData?.get('action') === 'apply_all'

  // Job polling state
  const computeFetcher = useFetcher()
  const [activeJobId, setActiveJobId] = useState<number | null>(latestJob?.status === 'running' ? latestJob.id : null)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const computeFetcherRef = useRef(computeFetcher)
  computeFetcherRef.current = computeFetcher
  const revalidatorRef = useRef(revalidator)
  revalidatorRef.current = revalidator

  // Start polling when job becomes active
  useEffect(() => {
    if (activeJobId) {
      pollInterval.current = setInterval(() => {
        computeFetcherRef.current.submit(
          { action: 'check_compute_status', job_id: String(activeJobId) },
          { method: 'post' },
        )
      }, 2000)
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current)
    }
  }, [activeJobId])

  // Handle poll responses
  const [jobProgress, setJobProgress] = useState<{ processed: number; total: number; diffsFound: number } | null>(null)
  useEffect(() => {
    const data = computeFetcher.data as
      | {
          computeJobStatus?: { status: string; result?: { processed?: number; total?: number; diffsFound?: number } }
        }
      | undefined
    if (data?.computeJobStatus) {
      const { status, result: jobResult } = data.computeJobStatus
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        setActiveJobId(null)
        setJobProgress(null)
        if (pollInterval.current) clearInterval(pollInterval.current)
        revalidatorRef.current.revalidate()
      } else if (jobResult?.processed != null && jobResult?.total != null) {
        setJobProgress({
          processed: jobResult.processed,
          total: jobResult.total,
          diffsFound: jobResult.diffsFound ?? 0,
        })
      }
    }
  }, [computeFetcher.data])

  // Handle compute_diffs trigger response from admin page
  const triggerFetcher = useFetcher()
  const triggerData = triggerFetcher.data as { computeDiffsJobStarted?: number; error?: string } | undefined
  useEffect(() => {
    if (triggerData?.computeDiffsJobStarted) {
      setActiveJobId(triggerData.computeDiffsJobStarted)
    }
  }, [triggerData])

  const triggerError = triggerFetcher.state === 'idle' ? (triggerData?.error ?? null) : null

  const isComputing = !!activeJobId || triggerFetcher.state !== 'idle'

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const toggleId = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const toggleAll = () => {
    setSelectedIds((prev) => (prev.length === diffs.length ? [] : diffs.map((d) => d.id)))
  }

  // Clear selection when diffs change (after revalidation)
  const prevDiffCount = useRef(diffs.length)
  useEffect(() => {
    if (diffs.length !== prevDiffCount.current) {
      setSelectedIds([])
      prevDiffCount.current = diffs.length
    }
  })

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <VStack gap="space-2">
          <Heading level="1" size="large">
            Verifiseringsavvik
          </Heading>
          <BodyShort textColor="subtle">
            Deployments hvor lagret og ny verifisering gir forskjellig resultat. Klikk på en deployment for detaljer.
          </BodyShort>
        </VStack>

        {/* Compute trigger and status */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <HStack gap="space-4" align="center" justify="space-between">
            <VStack gap="space-1">
              {lastComputed ? (
                <Detail>Sist beregnet: {new Date(lastComputed).toLocaleString('no-NO')}</Detail>
              ) : (
                <Detail>Avvik er ikke beregnet ennå. Klikk «Beregn avvik» for å starte.</Detail>
              )}
            </VStack>
            {appContext && (
              <triggerFetcher.Form
                method="post"
                action={`/team/${appContext.teamSlug}/env/${appContext.environmentName}/app/${appContext.appName}/admin`}
              >
                <input type="hidden" name="action" value="compute_diffs" />
                <input type="hidden" name="app_id" value={appContext.monitoredAppId} />
                <Button type="submit" size="small" variant="secondary" loading={isComputing}>
                  {isComputing ? 'Beregner…' : 'Beregn avvik'}
                </Button>
              </triggerFetcher.Form>
            )}
          </HStack>
          {isComputing && (
            <Box marginBlock="space-2 space-0">
              <HStack gap="space-2" align="center">
                <Loader size="xsmall" />
                <Detail>
                  {jobProgress
                    ? `Sjekker deployment ${jobProgress.processed} av ${jobProgress.total}${jobProgress.diffsFound > 0 ? ` — ${jobProgress.diffsFound} avvik funnet` : ''}…`
                    : 'Beregner avvik i bakgrunnen…'}
                </Detail>
              </HStack>
            </Box>
          )}
          {triggerError && !isComputing && (
            <Box marginBlock="space-2 space-0">
              <Alert variant="warning" size="small">
                {triggerError}
              </Alert>
            </Box>
          )}
        </Box>

        {diffs.length === 0 && lastComputed ? (
          <Box background="success-soft" padding="space-4" borderRadius="8">
            <BodyShort>✅ Ingen avvik funnet blant deployments med nedlastet GitHub-data.</BodyShort>
          </Box>
        ) : diffs.length === 0 && !lastComputed ? null : (
          <Box background="warning-soft" padding="space-4" borderRadius="8">
            <BodyShort>⚠️ {diffs.length} deployment(s) med avvik mellom gammel og ny verifisering.</BodyShort>
          </Box>
        )}

        {diffs.length > 0 && (
          <VStack gap="space-4">
            <Form method="post">
              <input type="hidden" name="action" value="apply_all" />
              {selectedIds.map((id) => (
                <input key={id} type="hidden" name="deployment_ids" value={id} />
              ))}
              <HStack gap="space-4" align="center">
                <Button
                  type="submit"
                  size="small"
                  variant="secondary"
                  loading={isApplyingAll}
                  disabled={selectedIds.length === 0}
                >
                  Oppdater valgte ({selectedIds.length})
                </Button>
                {selectedIds.length > 0 && selectedIds.length < diffs.length && (
                  <Detail>
                    {selectedIds.length} av {diffs.length} valgt
                  </Detail>
                )}
              </HStack>
            </Form>

            <Table>
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
                  <Table.HeaderCell>Deployment</Table.HeaderCell>
                  <Table.HeaderCell>Miljø</Table.HeaderCell>
                  <Table.HeaderCell>Dato</Table.HeaderCell>
                  <Table.HeaderCell>Gammel status</Table.HeaderCell>
                  <Table.HeaderCell>Ny status</Table.HeaderCell>
                  <Table.HeaderCell>Four eyes</Table.HeaderCell>
                  <Table.HeaderCell />
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
                        to={
                          appContext
                            ? `/team/${appContext.teamSlug}/env/${appContext.environmentName}/app/${appContext.appName}/admin/verification-diff/${diff.id}`
                            : `/deployments/${diff.id}`
                        }
                      >
                        {diff.commitSha.substring(0, 7)}
                      </AkselLink>
                    </Table.DataCell>
                    <Table.DataCell>{diff.environmentName}</Table.DataCell>
                    <Table.DataCell>{new Date(diff.createdAt).toLocaleDateString('no-NO')}</Table.DataCell>
                    <Table.DataCell>
                      <Tag variant="neutral" size="small">
                        {getFourEyesStatusLabel(diff.oldStatus || 'null')}
                      </Tag>
                    </Table.DataCell>
                    <Table.DataCell>
                      <Tag variant={diff.newStatus === 'error' ? 'warning' : 'info'} size="small">
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
                          <Tag variant="warning" size="small">
                            {String(oldApproved)} → {String(newApproved)}
                          </Tag>
                        ) : (
                          <BodyShort size="small">{String(newApproved)}</BodyShort>
                        )
                      })()}
                    </Table.DataCell>
                    <Table.DataCell>
                      <Form method="post">
                        <input type="hidden" name="action" value="apply_reverification" />
                        <input type="hidden" name="deployment_id" value={diff.id} />
                        <Button
                          type="submit"
                          size="xsmall"
                          variant="tertiary"
                          loading={submittingId === String(diff.id)}
                        >
                          Oppdater
                        </Button>
                      </Form>
                    </Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </VStack>
        )}

        {/* Missing approver data */}
        {missingApproverDeployments.length > 0 && (
          <MissingApproverSection deployments={missingApproverDeployments} appContext={appContext} />
        )}
      </VStack>
    </Box>
  )
}

// =============================================================================
// Missing Approver Section
// =============================================================================

type LoaderData = Awaited<ReturnType<typeof loader>>
type MissingApproverClient = LoaderData['missingApproverDeployments'][number]

function MissingApproverSection({
  deployments,
  appContext,
}: {
  deployments: MissingApproverClient[]
  appContext: { teamSlug: string; environmentName: string; appName: string } | null
}) {
  const fetcher = useFetcher()
  const revalidator = useRevalidator()
  const isRefreshing = fetcher.state !== 'idle'
  const refreshResult = fetcher.data && 'refreshResult' in fetcher.data ? fetcher.data.refreshResult : null
  const errorResult = fetcher.data && 'error' in fetcher.data ? (fetcher.data.error as string) : null
  const prevRefreshing = useRef(false)

  useEffect(() => {
    if (prevRefreshing.current && !isRefreshing && refreshResult) {
      revalidator.revalidate()
    }
    prevRefreshing.current = isRefreshing
  }, [isRefreshing, refreshResult, revalidator])

  function handleRefresh() {
    fetcher.submit({ action: 'refresh_missing_approver' }, { method: 'post' })
  }

  return (
    <VStack gap="space-4">
      <Box background="danger-soft" padding="space-4" borderRadius="8">
        <HStack gap="space-4" align="center" justify="space-between">
          <BodyShort>
            ⚠️{' '}
            {deployments.length === 1
              ? '1 godkjent deployment mangler godkjenner-data.'
              : `${deployments.length} godkjente deployments mangler godkjenner-data.`}{' '}
            Disse vil blokkere leveranserapport.
          </BodyShort>
          <Button size="small" variant="secondary" onClick={handleRefresh} loading={isRefreshing}>
            Re-verifiser alle
          </Button>
        </HStack>
      </Box>
      {refreshResult && (
        <Alert variant={refreshResult.errors > 0 ? 'warning' : 'success'} size="small">
          Re-verifisering fullført: {refreshResult.refreshed} oppdatert, {refreshResult.skipped} hoppet over
          {refreshResult.errors > 0 && `, ${refreshResult.errors} feil`}.
        </Alert>
      )}
      {errorResult && (
        <Alert variant="error" size="small">
          {errorResult}
        </Alert>
      )}
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Deployment</Table.HeaderCell>
            <Table.HeaderCell>Miljø</Table.HeaderCell>
            <Table.HeaderCell>Dato</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>Deployer</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {deployments.map((d) => (
            <Table.Row key={d.id}>
              <Table.DataCell>
                <AkselLink
                  as={Link}
                  to={
                    appContext
                      ? `/team/${appContext.teamSlug}/env/${appContext.environmentName}/app/${appContext.appName}/deployments/${d.id}`
                      : `/deployments/${d.id}`
                  }
                >
                  {d.commitSha?.substring(0, 7) ?? '—'}
                </AkselLink>
              </Table.DataCell>
              <Table.DataCell>{d.environmentName}</Table.DataCell>
              <Table.DataCell>{new Date(d.createdAt).toLocaleDateString('no-NO')}</Table.DataCell>
              <Table.DataCell>
                <Tag variant="warning" size="small">
                  {getFourEyesStatusLabel(d.fourEyesStatus)}
                </Tag>
              </Table.DataCell>
              <Table.DataCell>{d.deployerUsername || '-'}</Table.DataCell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </VStack>
  )
}
