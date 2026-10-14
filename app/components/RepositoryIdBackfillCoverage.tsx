import { Alert, BodyShort, Button, Dialog, Heading, HStack, Link, Select, Table, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, Link as RouterLink, useFetcher, useRevalidator } from 'react-router'
import type {
  WorkflowRunBackfillPreviewClassification,
  WorkflowRunBackfillPreviewDeployment,
  WorkflowRunBackfillPreviewRepository,
  WorkflowRunRepositoryBackfillCoverage,
  WorkflowRunRepositoryIdBackfillJob,
} from '~/db/workflow-run-repository-backfill-coverage.server'

interface RepositoryIdBackfillCoverageProps {
  teams: string[]
  selectedTeam: string | null
  invalidTeam: boolean
  repositories: WorkflowRunRepositoryBackfillCoverage[]
  totals: {
    legacy: number
    eligible: number
  }
  previewRepository: WorkflowRunBackfillPreviewRepository | null
  previewDeployments: WorkflowRunBackfillPreviewDeployment[]
  invalidRepository: boolean
  returnToTeam: string | null
}

export function selectLatestBackfillJob(
  job: WorkflowRunRepositoryIdBackfillJob | null,
  polledJob: WorkflowRunRepositoryIdBackfillJob | null,
): WorkflowRunRepositoryIdBackfillJob | null {
  if (!polledJob) return job
  return !job || polledJob.id >= job.id ? polledJob : job
}

export function BackfillStatus({ message }: { message: string | null }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {message && <BodyShort size="small">{message}</BodyShort>}
    </div>
  )
}

function formatPercent(value: number, total: number): string {
  return total === 0 ? '–' : `${Math.round((value / total) * 100)} %`
}

function RepositoryBackfillAction({
  repository,
  job,
}: {
  repository: WorkflowRunRepositoryBackfillCoverage
  job: WorkflowRunRepositoryIdBackfillJob | null
}) {
  const fetcher = useFetcher()
  const statusFetcher = useFetcher()
  const fetcherData = fetcher.data as { backfillJobStarted?: number; error?: string } | undefined
  const polledJob = statusFetcher.data as { backfillJobStatus?: WorkflowRunRepositoryIdBackfillJob | null } | undefined
  const currentJob = selectLatestBackfillJob(job, polledJob?.backfillJobStatus ?? null)
  const isRunning = currentJob?.status === 'running' && !currentJob.lockExpired
  const [open, setOpen] = useState(false)
  const [showingStatus, setShowingStatus] = useState(false)
  const formId = `repository-id-backfill-${repository.repositoryId}`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const refreshedJobId = useRef<number | null>(null)
  const revalidator = useRevalidator()

  useEffect(() => {
    if (fetcherData?.backfillJobStarted) {
      setOpen(false)
    }
  }, [fetcherData?.backfillJobStarted])

  useEffect(() => {
    if (!isRunning || !job) return
    const timeout = setTimeout(() => {
      if (statusFetcher.state === 'idle') {
        statusFetcher.load(`?backfillJobStatus=${repository.repositoryId}`)
      }
    }, 3000)
    return () => clearTimeout(timeout)
  }, [isRunning, job, repository.repositoryId, statusFetcher, statusFetcher.state])

  useEffect(() => {
    if (
      job?.status !== 'running' ||
      !currentJob ||
      currentJob.status === 'running' ||
      currentJob?.lockExpired ||
      refreshedJobId.current === currentJob.id
    ) {
      return
    }
    refreshedJobId.current = currentJob.id
    revalidator.revalidate()
  }, [currentJob, job, revalidator])

  const displayedJob = currentJob
  const retryExpiredJob = displayedJob?.status === 'running' && displayedJob.lockExpired
  const statusText = isRunning
    ? 'Backfill kjører …'
    : retryExpiredJob
      ? 'Backfill-jobben har utløpt og kan startes på nytt.'
      : displayedJob?.status === 'completed'
        ? `Fullført: ${Number(displayedJob.result?.updated ?? 0).toLocaleString('no-NO')} oppdatert`
        : displayedJob?.status === 'failed'
          ? `Feilet: ${displayedJob.error ?? 'Ukjent feil'}`
          : displayedJob?.status === 'partial'
            ? 'Delvis fullført'
            : displayedJob?.status === 'cancelled'
              ? 'Avbrutt'
              : null
  const isStatusDialog = showingStatus || isRunning

  return (
    <VStack gap="space-8" align="start">
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setShowingStatus(false)
        }}
      >
        <Dialog.Trigger>
          <Button
            ref={triggerRef}
            type="button"
            size="small"
            variant="secondary"
            onClick={() => setShowingStatus(isRunning)}
          >
            {isRunning
              ? 'Vis backfillstatus'
              : fetcher.state !== 'idle'
                ? 'Starter backfill …'
                : retryExpiredJob
                  ? 'Prøv backfill på nytt'
                  : 'Backfill ID'}
          </Button>
        </Dialog.Trigger>
        <Dialog.Popup returnFocusTo={() => triggerRef.current}>
          <Dialog.Header>
            <Dialog.Title>{isStatusDialog ? 'Backfillstatus' : 'Backfill repository-ID?'}</Dialog.Title>
            <Dialog.Description>
              {repository.githubOwner}/{repository.githubRepoName}
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            {isStatusDialog ? (
              <BackfillStatus message={statusText} />
            ) : (
              <VStack gap="space-12">
                <Alert variant="warning">
                  Kjøringen gjelder alle kvalifiserte legacy-deployments for repositoryet på tvers av alle team og
                  apper. Teamfilteret begrenser bare tabellvisningen, ikke hva som blir oppdatert. Kandidatkriteriene
                  kontrolleres på nytt når jobben kjører.
                </Alert>
                {fetcherData?.error && <Alert variant="error">{fetcherData.error}</Alert>}
                <fetcher.Form id={formId} method="post">
                  <input type="hidden" name="action" value="backfill_repository" />
                  <input type="hidden" name="repository_id" value={repository.repositoryId} />
                  <input type="hidden" name="confirm_repository_scope" value="true" />
                </fetcher.Form>
              </VStack>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            {isStatusDialog ? (
              <Dialog.CloseTrigger>
                <Button type="button" variant="secondary">
                  Lukk
                </Button>
              </Dialog.CloseTrigger>
            ) : (
              <>
                <Dialog.CloseTrigger>
                  <Button type="button" variant="secondary">
                    Avbryt
                  </Button>
                </Dialog.CloseTrigger>
                <Button type="submit" form={formId} loading={fetcher.state !== 'idle'}>
                  Start backfill
                </Button>
              </>
            )}
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog>
      {!open && <BackfillStatus message={statusText} />}
    </VStack>
  )
}

const classificationLabels: Record<WorkflowRunBackfillPreviewClassification, string> = {
  eligible: 'Kandidat',
  no_trigger_url: 'Mangler workflow-run-lenke',
  invalid_trigger_url: 'Ugyldig workflow-run-lenke eller run-ID',
  trigger_url_mismatch: 'Workflow-run-lenken viser et annet repository',
  missing_snapshot: 'Mangler lagret workflow-run-snapshot',
  repository_mismatch: 'Snapshot har et annet eller manglende repository-ID',
  sha_mismatch: 'Commit-SHA stemmer ikke',
  unsupported_event: 'Eventtypen er ikke push',
  head_repository_mismatch: 'Head repository stemmer ikke',
}

export function RepositoryIdBackfillCoverage({
  teams,
  selectedTeam,
  invalidTeam,
  repositories,
  totals,
  previewRepository,
  previewDeployments,
  invalidRepository,
  returnToTeam,
}: RepositoryIdBackfillCoverageProps) {
  if (previewRepository) {
    return (
      <VStack gap="space-24">
        <div>
          <Heading level="1" size="large" spacing>
            Repository-ID-backfill – forhåndsvisning
          </Heading>
          <BodyShort textColor="subtle">
            Skrivebeskyttet oversikt over konkrete legacy-deployments på tvers av team for{' '}
            {previewRepository.githubOwner}/{previewRepository.githubRepoName}.
          </BodyShort>
        </div>
        <Link
          as={RouterLink}
          to={returnToTeam ? `?team=${encodeURIComponent(returnToTeam)}` : '/admin/repository-id-backfill-coverage'}
        >
          Tilbake til teamrapporten
        </Link>
        <Alert variant="info">
          Viser alle legacy-deployments som kan knyttes entydig til dette registrerte repositoryet på tvers av
          tilknyttede apper og Nais-team. Bare deployments uten repository-ID inngår. Tvetydige repository-navn
          utelates. Ingen rader endres.
        </Alert>
        <BodyShort>
          <strong>{totals.eligible.toLocaleString('no-NO')}</strong> av{' '}
          <strong>{totals.legacy.toLocaleString('no-NO')}</strong> deployments er kandidater (
          {formatPercent(totals.eligible, totals.legacy)}).
        </BodyShort>
        {previewDeployments.length === 0 ? (
          <BodyShort>Ingen entydig tilknyttede legacy-deployments ble funnet for repositoryet.</BodyShort>
        ) : (
          <Table
            aria-label={`Legacy-deployments for ${previewRepository.githubOwner}/${previewRepository.githubRepoName}`}
          >
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Deployment-ID</Table.HeaderCell>
                <Table.HeaderCell scope="col">Nais-team og app</Table.HeaderCell>
                <Table.HeaderCell scope="col">Opprettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Commit-SHA</Table.HeaderCell>
                <Table.HeaderCell scope="col">Workflow-run-ID</Table.HeaderCell>
                <Table.HeaderCell scope="col">Vurdering</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {previewDeployments.map((deployment) => (
                <Table.Row key={deployment.deploymentId}>
                  <Table.HeaderCell scope="row">{deployment.deploymentId}</Table.HeaderCell>
                  <Table.DataCell>
                    {deployment.teamSlug} / {deployment.appName} ({deployment.environmentName})
                  </Table.DataCell>
                  <Table.DataCell>{new Date(deployment.createdAt).toLocaleString('nb-NO')}</Table.DataCell>
                  <Table.DataCell>{deployment.commitSha ?? '–'}</Table.DataCell>
                  <Table.DataCell>{deployment.workflowRunId ?? '–'}</Table.DataCell>
                  <Table.DataCell>{classificationLabels[deployment.classification]}</Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </VStack>
    )
  }

  if (invalidRepository) {
    return (
      <VStack gap="space-24">
        <Heading level="1" size="large">
          Repository-ID-backfill – forhåndsvisning
        </Heading>
        <Alert variant="warning">Ukjent eller ugyldig repository-ID. Velg et repository fra rapporten.</Alert>
        <Link
          as={RouterLink}
          to={returnToTeam ? `?team=${encodeURIComponent(returnToTeam)}` : '/admin/repository-id-backfill-coverage'}
        >
          Tilbake til teamrapporten
        </Link>
      </VStack>
    )
  }

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Dekning for repository-ID fra workflow runs
        </Heading>
        <BodyShort textColor="subtle">
          Rapporten viser deployments uten repository-ID ved å bruke lagrede workflow-run-snapshots. Velg et Nais-team
          for å avgrense hvilke repositories som vises. Backfill-handlingen per repository gjelder alltid alle
          kvalifiserte deployments på tvers av team og apper.
        </BodyShort>
      </div>

      <Form method="get">
        <HStack gap="space-16" align="end" wrap>
          <Select
            key={selectedTeam ?? 'no-team-selected'}
            label="Nais-team"
            name="team"
            defaultValue={selectedTeam ?? ''}
          >
            <option value="">Velg team</option>
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </Select>
          <Button type="submit">Vis dekning</Button>
        </HStack>
      </Form>

      {invalidTeam && <Alert variant="warning">Ukjent Nais-team. Velg et team fra listen og prøv igjen.</Alert>}
      {selectedTeam ? (
        <>
          <Alert variant="info">
            Rapporttallene gjelder bare deployments for apper knyttet til Nais-teamet <strong>{selectedTeam}</strong>.
            Et deployment regnes som kandidat bare når workflow-run-snapshotet har samme repository-ID og head
            repository-ID som repositoryet, samme commit-SHA som deploymentet, og eventtypen er push. Handlingene i
            tabellen kjører repositoryomfattende og er ikke begrenset til dette teamet.
          </Alert>

          <BodyShort>
            <strong>{totals.eligible.toLocaleString('no-NO')}</strong> av{' '}
            <strong>{totals.legacy.toLocaleString('no-NO')}</strong> deployments uten repository-ID er kandidater (
            {formatPercent(totals.eligible, totals.legacy)}).
          </BodyShort>

          {repositories.length === 0 ? (
            <BodyShort>
              Ingen eldre deployments uten repository-ID ble funnet for registrerte repositories knyttet til dette
              teamet.
            </BodyShort>
          ) : (
            <Table aria-label={`Repository-ID-backfilldekning for Nais-team ${selectedTeam}`}>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Repository</Table.HeaderCell>
                  <Table.HeaderCell align="right">Uten ID i rapportens scope</Table.HeaderCell>
                  <Table.HeaderCell align="right">Kandidater</Table.HeaderCell>
                  <Table.HeaderCell align="right">Dekning</Table.HeaderCell>
                  <Table.HeaderCell align="right">Mangler snapshot</Table.HeaderCell>
                  <Table.HeaderCell>Andre årsaker</Table.HeaderCell>
                  <Table.HeaderCell>Handling</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {repositories.map((repository) => {
                  const reasons = [
                    `uten run-lenke ${repository.noTriggerUrl}`,
                    `ugyldig lenke ${repository.invalidTriggerUrl}`,
                    `URL-avvik ${repository.triggerUrlMismatch}`,
                    `repository-ID-avvik ${repository.repositoryMismatch}`,
                    `SHA-avvik ${repository.shaMismatch}`,
                    `event ikke push ${repository.unsupportedEvent}`,
                    `head-repo-avvik ${repository.headRepositoryMismatch}`,
                  ]
                  return (
                    <Table.Row key={repository.repositoryId}>
                      <Table.HeaderCell scope="row">
                        <Link
                          as={RouterLink}
                          to={`/admin/repository-id-backfill-coverage?repositoryId=${repository.repositoryId}&team=${encodeURIComponent(selectedTeam)}`}
                        >
                          {repository.githubOwner}/{repository.githubRepoName} – vis alle team
                        </Link>
                      </Table.HeaderCell>
                      <Table.DataCell align="right">
                        {repository.totalLegacyDeployments.toLocaleString('no-NO')}
                      </Table.DataCell>
                      <Table.DataCell align="right">{repository.eligible.toLocaleString('no-NO')}</Table.DataCell>
                      <Table.DataCell align="right">
                        {formatPercent(repository.eligible, repository.totalLegacyDeployments)}
                      </Table.DataCell>
                      <Table.DataCell align="right">
                        {repository.missingSnapshot.toLocaleString('no-NO')}
                      </Table.DataCell>
                      <Table.DataCell>
                        <BodyShort size="small">{reasons.join('; ')}</BodyShort>
                      </Table.DataCell>
                      <Table.DataCell>
                        <RepositoryBackfillAction repository={repository} job={repository.backfillJob} />
                      </Table.DataCell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          )}
        </>
      ) : (
        <BodyShort>Velg et Nais-team for å hente rapporten.</BodyShort>
      )}
    </VStack>
  )
}
