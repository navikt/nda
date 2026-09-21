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
import { Form, Link, useActionData, useFetcher, useLoaderData, useNavigation, useRevalidator } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { ErrorReasonWithLink } from '~/components/ErrorReasonWithLink'
import { UserName } from '~/components/UserName'
import { pool } from '~/db/connection.server'
import { getRepositoryById, isCurrentOrHistoricalNameForRepositoryId } from '~/db/repositories.server'
import { getLatestSyncJobForRepository, getSyncJobById } from '~/db/sync-jobs.server'
import { getGithubUserLookups } from '~/db/user-github-lookups.server'
import {
  getApprovedDeploymentsMissingApproverForApps,
  getVerificationDiffsForApps,
} from '~/db/verification-diff.server'
import { requireUser } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { getFormString } from '~/lib/form-validators'
import { type FourEyesStatus, getFourEyesStatusLabel, isApprovedStatus } from '~/lib/four-eyes-status'
import { logger } from '~/lib/logger.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import { serializeUserLookups } from '~/lib/user-display'
import { reverifyDeployment } from '~/lib/verification'
import type { Route } from './+types/repository.$owner.$repo.admin.verification-diff'

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
  teamSlug: string
  appName: string
}

function describeComputePartialResult(
  result: { errors?: number; appsSkippedLocked?: number } | null | undefined,
): string | null {
  if (!result) return null
  const errors = result.errors ?? 0
  const skipped = result.appsSkippedLocked ?? 0
  if (errors === 0 && skipped === 0) return null
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} feil oppstod under beregningen`)
  if (skipped > 0) parts.push(`${skipped} app(er) ble hoppet over pga. en annen kjørende jobb`)
  return `Beregningen ble fullført, men ikke alle apper ble prosessert: ${parts.join(', ')}. Avvikene som vises kan derfor være ufullstendige.`
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const user = await requireUser(request)
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, '/admin/verification-diff')

  const { authorized, affectedApps } = await resolveRepositoryAdminAccess(user, repository.id)
  if (!authorized) {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }

  const appIds = affectedApps.map((app) => app.id)

  const [diffRows, latestJob, latestRefreshJob, missingApproverRows] = await Promise.all([
    getVerificationDiffsForApps(appIds),
    getLatestSyncJobForRepository(repository.id, 'reverify_app'),
    getLatestSyncJobForRepository(repository.id, 'refresh_missing_approver'),
    getApprovedDeploymentsMissingApproverForApps(appIds),
  ])

  const diffs: DeploymentDiff[] = diffRows.map((row) => ({
    id: row.deployment_id,
    commitSha: row.commit_sha,
    environmentName: row.environment_name,
    createdAt: row.created_at.toISOString(),
    oldStatus: row.old_status,
    newStatus: row.new_status,
    errorReason: row.error_reason,
    githubOwner: row.detected_github_owner,
    githubRepoName: row.detected_github_repo_name,
    teamSlug: row.team_slug,
    appName: row.app_name,
  }))

  const lastComputed =
    latestJob?.status === 'completed' && latestJob.completed_at ? new Date(latestJob.completed_at).toISOString() : null

  const missingApproverDeployments = missingApproverRows.map((row) => ({
    id: row.id,
    commitSha: row.commit_sha,
    fourEyesStatus: row.four_eyes_status,
    environmentName: row.environment_name,
    createdAt: row.created_at.toISOString(),
    deployerUsername: row.deployer_username,
    teamSlug: row.team_slug,
    appName: row.app_name,
  }))

  const deployerUsernames = [
    ...new Set(missingApproverRows.map((row) => row.deployer_username).filter((u): u is string => !!u)),
  ]
  const userMappings = serializeUserLookups(
    deployerUsernames.length > 0 ? await getGithubUserLookups(deployerUsernames) : new Map(),
  )

  return {
    repositoryContext: {
      id: repository.id,
      githubOwner: repository.github_owner,
      githubRepoName: repository.github_repo_name,
    },
    diffs,
    missingApproverDeployments,
    userMappings,
    lastComputed,
    latestJob,
    latestRefreshJob,
  }
}

async function getDeploymentAppIds(deploymentIds: number[]): Promise<Map<number, number>> {
  if (deploymentIds.length === 0) return new Map()
  const result = await pool.query<{ id: number; monitored_app_id: number }>(
    'SELECT id, monitored_app_id FROM deployments WHERE id = ANY($1)',
    [deploymentIds],
  )
  return new Map(result.rows.map((row) => [row.id, row.monitored_app_id]))
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const { owner, repo } = requireParams(params, ['owner', 'repo'])

  const formData = await request.formData()

  const repositoryIdRaw = formData.get('repository_id')
  const repositoryId = typeof repositoryIdRaw === 'string' ? Number(repositoryIdRaw) : Number.NaN
  if (!Number.isInteger(repositoryId) || repositoryId <= 0 || repositoryId > 2_147_483_647) {
    return { error: 'Ugyldig eller manglende repository-ID' }
  }

  const repository = await getRepositoryById(repositoryId)
  if (!repository) {
    return { error: 'Fant ikke repositoryet' }
  }
  if (!(await isCurrentOrHistoricalNameForRepositoryId(repository.id, owner, repo))) {
    return { error: 'Repository-ID samsvarer ikke med repositoryet i URL-en' }
  }
  const { authorized, affectedApps } = await resolveRepositoryAdminAccess(user, repositoryId)
  if (!authorized) {
    return { error: 'Du har ikke administratortilgang til alle appene i dette repoet' }
  }

  const appIds = affectedApps.map((app) => app.id)
  const appIdSet = new Set(appIds)

  const actionType = getFormString(formData, 'action')

  if (actionType === 'apply_reverification') {
    const deploymentId = Number.parseInt(getFormString(formData, 'deployment_id') ?? '', 10)
    if (!Number.isFinite(deploymentId)) {
      return { error: 'Mangler eller ugyldig deployment_id' }
    }
    const deploymentAppIds = await getDeploymentAppIds([deploymentId])
    const deploymentAppId = deploymentAppIds.get(deploymentId)
    if (deploymentAppId == null || !appIdSet.has(deploymentAppId)) {
      return { error: `Deployment ${deploymentId} tilhører ikke dette repositoryet` }
    }
    try {
      const result = await reverifyDeployment(deploymentId)
      if (!result) {
        return { error: `Deployment ${deploymentId} ble hoppet over (manuelt godkjent, legacy, eller mangler data)` }
      }
      if (result.changed) {
        await pool.query('DELETE FROM verification_diffs WHERE deployment_id = $1', [deploymentId])
        const message = `Oppdatert: ${result.oldStatus} → ${result.newStatus}`
        return {
          applied: deploymentId,
          message,
          success: message,
        }
      }
      return { applied: deploymentId, message: 'Ingen endring nødvendig', success: 'Ingen endring nødvendig' }
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
    const ids = formData
      .getAll('deployment_ids')
      .map((id) => Number.parseInt(id as string, 10))
      .filter((id) => Number.isFinite(id))
    const deploymentAppIds = await getDeploymentAppIds(ids)
    let applied = 0
    let skipped = 0
    let errors = 0

    for (const id of ids) {
      const deploymentAppId = deploymentAppIds.get(id)
      if (deploymentAppId == null || !appIdSet.has(deploymentAppId)) {
        errors++
        continue
      }
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

    const success = `${applied} oppdatert, ${skipped} hoppet over${errors > 0 ? `, ${errors} feil` : ''}`
    return { appliedAll: true, applied, skipped, errors, success }
  }

  if (actionType === 'check_compute_status') {
    const jobId = Number.parseInt(getFormString(formData, 'job_id') ?? '', 10)
    if (!Number.isFinite(jobId)) return { error: 'Mangler eller ugyldig job_id' }
    const job = await getSyncJobById(jobId)
    if (!job || job.repository_id !== repositoryId || job.job_type !== 'reverify_app') {
      return { error: 'Fant ikke jobb for dette repositoryet' }
    }
    return { computeJobStatus: job }
  }

  if (actionType === 'check_refresh_status') {
    const jobId = Number.parseInt(getFormString(formData, 'job_id') ?? '', 10)
    if (!Number.isFinite(jobId)) return { error: 'Mangler eller ugyldig job_id' }
    const job = await getSyncJobById(jobId)
    if (!job || job.repository_id !== repositoryId || job.job_type !== 'refresh_missing_approver') {
      return { error: 'Fant ikke jobb for dette repositoryet' }
    }
    return { refreshJobStatus: job }
  }

  return null
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Verifiseringsavvik' }]
}

export default function RepositoryVerificationDiffPage() {
  const {
    diffs,
    missingApproverDeployments,
    userMappings,
    repositoryContext,
    lastComputed,
    latestJob,
    latestRefreshJob,
  } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const submittingId = navigation.state === 'submitting' ? navigation.formData?.get('deployment_id')?.toString() : null
  const isApplyingAll = navigation.state === 'submitting' && navigation.formData?.get('action') === 'apply_all'

  const computeFetcher = useFetcher()
  const [activeJobId, setActiveJobId] = useState<number | null>(latestJob?.status === 'running' ? latestJob.id : null)
  const [jobError, setJobError] = useState<string | null>(
    latestJob?.status === 'failed'
      ? 'Beregning av avvik feilet.'
      : latestJob?.status === 'cancelled'
        ? 'Beregning av avvik ble avbrutt.'
        : null,
  )
  const [jobWarning, setJobWarning] = useState<string | null>(
    latestJob?.status === 'completed' ? describeComputePartialResult(latestJob.result) : null,
  )
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const computeFetcherRef = useRef(computeFetcher)
  computeFetcherRef.current = computeFetcher
  const revalidatorRef = useRef(revalidator)
  revalidatorRef.current = revalidator

  useEffect(() => {
    if (activeJobId) {
      pollInterval.current = setInterval(() => {
        computeFetcherRef.current.submit(
          { action: 'check_compute_status', job_id: String(activeJobId), repository_id: String(repositoryContext.id) },
          { method: 'post' },
        )
      }, 2000)
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current)
    }
  }, [activeJobId, repositoryContext.id])

  const [jobProgress, setJobProgress] = useState<{ processed: number; total: number; diffsFound: number } | null>(null)
  useEffect(() => {
    const data = computeFetcher.data as
      | {
          computeJobStatus?: {
            status: string
            result?: {
              appsProcessed?: number
              appsTotal?: number
              diffsFound?: number
              errors?: number
              appsSkippedLocked?: number
            }
          }
        }
      | undefined
    if (data?.computeJobStatus) {
      const { status, result: jobResult } = data.computeJobStatus
      if (status === 'completed') {
        setActiveJobId(null)
        setJobProgress(null)
        setJobError(null)
        setJobWarning(describeComputePartialResult(jobResult ?? null))
        if (pollInterval.current) clearInterval(pollInterval.current)
        revalidatorRef.current.revalidate()
      } else if (status === 'failed' || status === 'cancelled') {
        setActiveJobId(null)
        setJobProgress(null)
        setJobWarning(null)
        setJobError(status === 'failed' ? 'Beregning av avvik feilet.' : 'Beregning av avvik ble avbrutt.')
        if (pollInterval.current) clearInterval(pollInterval.current)
        revalidatorRef.current.revalidate()
      } else if (jobResult?.appsProcessed != null && jobResult?.appsTotal != null) {
        setJobProgress({
          processed: jobResult.appsProcessed,
          total: jobResult.appsTotal,
          diffsFound: jobResult.diffsFound ?? 0,
        })
      }
    }
  }, [computeFetcher.data])

  const triggerFetcher = useFetcher()
  const triggerData = triggerFetcher.data as { computeDiffsJobStarted?: number; error?: string } | undefined
  useEffect(() => {
    if (triggerData?.computeDiffsJobStarted) {
      setActiveJobId(triggerData.computeDiffsJobStarted)
      setJobError(null)
      setJobWarning(null)
    }
  }, [triggerData])

  const triggerError = triggerFetcher.state === 'idle' ? (triggerData?.error ?? null) : null

  const isComputing = !!activeJobId || triggerFetcher.state !== 'idle'

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const toggleId = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const toggleAll = () => {
    setSelectedIds((prev) => (prev.length === diffs.length ? [] : diffs.map((d) => d.id)))
  }

  useEffect(() => {
    const currentDiffIds = new Set(diffs.map((d) => d.id))
    setSelectedIds((prev) => prev.filter((id) => currentDiffIds.has(id)))
  }, [diffs])

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <VStack gap="space-2">
          <Heading level="1" size="large">
            Verifiseringsavvik
          </Heading>
          <BodyShort textColor="subtle">
            Deployments hvor lagret og ny verifisering gir forskjellig resultat, på tvers av alle apper knyttet til
            dette repositoryet. Klikk på en deployment for detaljer.
          </BodyShort>
        </VStack>

        <ActionAlert data={actionData} />

        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <HStack gap="space-4" align="center" justify="space-between">
            <VStack gap="space-1">
              {lastComputed ? (
                <Detail>Sist beregnet: {new Date(lastComputed).toLocaleString('no-NO')}</Detail>
              ) : (
                <Detail>Avvik er ikke beregnet ennå. Klikk «Beregn avvik» for å starte.</Detail>
              )}
            </VStack>
            <triggerFetcher.Form
              method="post"
              action={`/repository/${repositoryContext.githubOwner}/${repositoryContext.githubRepoName}/admin`}
            >
              <input type="hidden" name="action" value="compute_diffs" />
              <input type="hidden" name="repository_id" value={repositoryContext.id} />
              <Button type="submit" size="small" variant="secondary" loading={isComputing}>
                {isComputing ? 'Beregner…' : 'Beregn avvik'}
              </Button>
            </triggerFetcher.Form>
          </HStack>
          {isComputing && (
            <Box marginBlock="space-2 space-0" role="status" aria-live="polite">
              <HStack gap="space-2" align="center">
                <Loader size="xsmall" title="Beregner avvik i bakgrunnen" />
                <Detail>
                  {jobProgress
                    ? `Sjekker app ${jobProgress.processed} av ${jobProgress.total}${jobProgress.diffsFound > 0 ? ` — ${jobProgress.diffsFound} avvik funnet` : ''}…`
                    : 'Beregner avvik i bakgrunnen…'}
                </Detail>
              </HStack>
            </Box>
          )}
          {jobError && !isComputing && (
            <Box marginBlock="space-2 space-0">
              <Alert variant="error" size="small">
                {jobError}
              </Alert>
            </Box>
          )}
          {jobWarning && !isComputing && !jobError && (
            <Box marginBlock="space-2 space-0">
              <Alert variant="warning" size="small">
                {jobWarning}
              </Alert>
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
              <input type="hidden" name="repository_id" value={repositoryContext.id} />
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

            <Table aria-label="Verifiseringsavvik">
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
                  <Table.HeaderCell>App</Table.HeaderCell>
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
                        to={`/team/${diff.teamSlug}/env/${diff.environmentName}/app/${diff.appName}/admin/verification-diff/${diff.id}`}
                      >
                        {diff.commitSha.substring(0, 7)}
                      </AkselLink>
                    </Table.DataCell>
                    <Table.DataCell>{diff.appName}</Table.DataCell>
                    <Table.DataCell>{diff.environmentName}</Table.DataCell>
                    <Table.DataCell>{new Date(diff.createdAt).toLocaleDateString('no-NO')}</Table.DataCell>
                    <Table.DataCell>
                      <Tag variant="neutral" size="small">
                        {getFourEyesStatusLabel(diff.oldStatus || 'null')}
                      </Tag>
                    </Table.DataCell>
                    <Table.DataCell>
                      <Tag
                        variant={
                          diff.newStatus === 'error' || diff.newStatus === 'pending_sibling_resolution'
                            ? 'warning'
                            : 'info'
                        }
                        size="small"
                      >
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
                        <input type="hidden" name="repository_id" value={repositoryContext.id} />
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

        {missingApproverDeployments.length > 0 && (
          <MissingApproverSection
            deployments={missingApproverDeployments}
            userMappings={userMappings}
            repositoryId={repositoryContext.id}
            githubOwner={repositoryContext.githubOwner}
            githubRepoName={repositoryContext.githubRepoName}
            latestRefreshJob={latestRefreshJob}
          />
        )}
      </VStack>
    </Box>
  )
}

type LoaderData = Awaited<ReturnType<typeof loader>>
type MissingApproverClient = LoaderData['missingApproverDeployments'][number]
type UserMappings = LoaderData['userMappings']
type LatestRefreshJob = LoaderData['latestRefreshJob']

function describeRefreshPartialResult(result: { errors?: number } | null | undefined): string | null {
  if (!result) return null
  const errors = result.errors ?? 0
  if (errors === 0) return null
  return `Oppdateringen ble fullført, men ${errors} deployment(er) feilet. Disse kan fortsatt mangle godkjenner.`
}

function MissingApproverSection({
  deployments,
  userMappings,
  repositoryId,
  githubOwner,
  githubRepoName,
  latestRefreshJob,
}: {
  deployments: MissingApproverClient[]
  userMappings: UserMappings
  repositoryId: number
  githubOwner: string
  githubRepoName: string
  latestRefreshJob: LatestRefreshJob
}) {
  const statusFetcher = useFetcher()
  const triggerFetcher = useFetcher()
  const cancelFetcher = useFetcher()
  const revalidator = useRevalidator()

  const [activeJobId, setActiveJobId] = useState<number | null>(
    latestRefreshJob?.status === 'running' ? latestRefreshJob.id : null,
  )
  const [jobProgress, setJobProgress] = useState<{
    processed: number
    total: number
    refreshed: number
    skipped: number
    errors: number
  } | null>(null)
  const [jobError, setJobError] = useState<string | null>(
    latestRefreshJob?.status === 'failed'
      ? 'Oppdatering av godkjennere feilet.'
      : latestRefreshJob?.status === 'cancelled'
        ? 'Oppdatering av godkjennere ble avbrutt.'
        : null,
  )
  const [jobWarning, setJobWarning] = useState<string | null>(
    latestRefreshJob?.status === 'completed' ? describeRefreshPartialResult(latestRefreshJob.result) : null,
  )
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusFetcherRef = useRef(statusFetcher)
  statusFetcherRef.current = statusFetcher
  const revalidatorRef = useRef(revalidator)
  revalidatorRef.current = revalidator

  useEffect(() => {
    if (activeJobId) {
      pollInterval.current = setInterval(() => {
        statusFetcherRef.current.submit(
          { action: 'check_refresh_status', job_id: String(activeJobId), repository_id: String(repositoryId) },
          { method: 'post' },
        )
      }, 2000)
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current)
    }
  }, [activeJobId, repositoryId])

  useEffect(() => {
    const data = statusFetcher.data as
      | {
          refreshJobStatus?: {
            status: string
            result?: { processed?: number; total?: number; refreshed?: number; skipped?: number; errors?: number }
          }
        }
      | undefined
    if (data?.refreshJobStatus) {
      const { status, result: jobResult } = data.refreshJobStatus
      if (status === 'completed') {
        setActiveJobId(null)
        setJobProgress(null)
        setJobError(null)
        setJobWarning(describeRefreshPartialResult(jobResult ?? null))
        if (pollInterval.current) clearInterval(pollInterval.current)
        revalidatorRef.current.revalidate()
      } else if (status === 'failed' || status === 'cancelled') {
        setActiveJobId(null)
        setJobProgress(null)
        setJobWarning(null)
        setJobError(
          status === 'failed' ? 'Oppdatering av godkjennere feilet.' : 'Oppdatering av godkjennere ble avbrutt.',
        )
        if (pollInterval.current) clearInterval(pollInterval.current)
        revalidatorRef.current.revalidate()
      } else if (jobResult?.processed != null && jobResult?.total != null) {
        setJobProgress({
          processed: jobResult.processed,
          total: jobResult.total,
          refreshed: jobResult.refreshed ?? 0,
          skipped: jobResult.skipped ?? 0,
          errors: jobResult.errors ?? 0,
        })
      }
    }
  }, [statusFetcher.data])

  const triggerData = triggerFetcher.data as { refreshJobStarted?: number; error?: string } | undefined
  useEffect(() => {
    if (triggerData?.refreshJobStarted) {
      setActiveJobId(triggerData.refreshJobStarted)
      setJobError(null)
      setJobWarning(null)
    }
  }, [triggerData])

  const triggerError = triggerFetcher.state === 'idle' ? (triggerData?.error ?? null) : null
  const isRefreshing = !!activeJobId || triggerFetcher.state !== 'idle'

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
          <HStack gap="space-2" align="center">
            <triggerFetcher.Form method="post" action={`/repository/${githubOwner}/${githubRepoName}/admin`}>
              <input type="hidden" name="action" value="refresh_missing_approver" />
              <input type="hidden" name="repository_id" value={repositoryId} />
              <Button type="submit" size="small" variant="secondary" loading={isRefreshing}>
                Re-verifiser alle
              </Button>
            </triggerFetcher.Form>
            {activeJobId && (
              <cancelFetcher.Form method="post" action={`/repository/${githubOwner}/${githubRepoName}/admin`}>
                <input type="hidden" name="action" value="cancel_refresh_job" />
                <input type="hidden" name="repository_id" value={repositoryId} />
                <input type="hidden" name="job_id" value={activeJobId} />
                <Button type="submit" size="small" variant="danger" loading={cancelFetcher.state !== 'idle'}>
                  Stopp
                </Button>
              </cancelFetcher.Form>
            )}
          </HStack>
        </HStack>
        {isRefreshing && (
          <Box marginBlock="space-2 space-0" role="status" aria-live="polite">
            <HStack gap="space-2" align="center">
              <Loader size="xsmall" title="Oppdaterer godkjennere i bakgrunnen" />
              <Detail>
                {jobProgress
                  ? `Sjekker deployment ${jobProgress.processed} av ${jobProgress.total} — ${jobProgress.refreshed} oppdatert, ${jobProgress.skipped} hoppet over${jobProgress.errors > 0 ? `, ${jobProgress.errors} feil` : ''}…`
                  : 'Oppdaterer godkjennere i bakgrunnen…'}
              </Detail>
            </HStack>
          </Box>
        )}
      </Box>
      {jobError && !isRefreshing && (
        <Alert variant="error" size="small">
          {jobError}
        </Alert>
      )}
      {jobWarning && !isRefreshing && !jobError && (
        <Alert variant="warning" size="small">
          {jobWarning}
        </Alert>
      )}
      {triggerError && !isRefreshing && (
        <Alert variant="warning" size="small">
          {triggerError}
        </Alert>
      )}
      <Table aria-label="Godkjente deployments som mangler godkjenner-data">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Deployment</Table.HeaderCell>
            <Table.HeaderCell>App</Table.HeaderCell>
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
                  to={`/team/${d.teamSlug}/env/${d.environmentName}/app/${d.appName}/deployments/${d.id}`}
                >
                  {d.commitSha?.substring(0, 7) ?? '—'}
                </AkselLink>
              </Table.DataCell>
              <Table.DataCell>{d.appName}</Table.DataCell>
              <Table.DataCell>{d.environmentName}</Table.DataCell>
              <Table.DataCell>{new Date(d.createdAt).toLocaleDateString('no-NO')}</Table.DataCell>
              <Table.DataCell>
                <Tag variant="warning" size="small">
                  {getFourEyesStatusLabel(d.fourEyesStatus)}
                </Tag>
              </Table.DataCell>
              <Table.DataCell>
                <UserName username={d.deployerUsername} userMappings={userMappings} link="github" />
              </Table.DataCell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </VStack>
  )
}
