/**
 * Verification Diff Page (App-specific)
 *
 * Shows pre-computed differences between stored verification status and
 * what V2 verification would produce. Diffs are computed by the
 * reverify_app sync job and stored in the verification_diffs table.
 */

import {
  Link as AkselLink,
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
import { pool } from '~/db/connection.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getLatestSyncJob, getSyncJobById } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import { type FourEyesStatus, getFourEyesStatusLabel, isApprovedStatus } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { reverifyDeployment } from '~/lib/verification'
import type { Route } from './+types/$team.env.$env.app.$app.admin.verification-diff'

interface DeploymentDiff {
  id: number
  commitSha: string
  environmentName: string
  createdAt: string
  oldStatus: string | null
  newStatus: string
  errorReason: string | null
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { team, env, app } = params

  const monitoredApp = await getMonitoredApplicationByIdentity(team, env, app)
  if (!monitoredApp) {
    return { diffs: [], appContext: null, lastComputed: null, latestJob: null }
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
            d.commit_sha, d.environment_name, d.created_at
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
  }))

  // Get last computation time from the latest completed job, not from diffs
  const latestJob = await getLatestSyncJob(monitoredApp.id, 'reverify_app')
  const lastComputed =
    latestJob?.status === 'completed' && latestJob.completed_at ? new Date(latestJob.completed_at).toISOString() : null

  return { diffs, appContext, lastComputed, latestJob }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

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

  return null
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiseringsavvik' }]
}

export default function VerificationDiffPage() {
  const { diffs, appContext, lastComputed, latestJob } = useLoaderData<typeof loader>()
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
  useEffect(() => {
    const data = triggerFetcher.data as { computeDiffsJobStarted?: number; error?: string } | undefined
    if (data?.computeDiffsJobStarted) {
      setActiveJobId(data.computeDiffsJobStarted)
    }
  }, [triggerFetcher.data])

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
                        <Detail textColor="subtle" className="mt-1">
                          {diff.errorReason}
                        </Detail>
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
      </VStack>
    </Box>
  )
}
