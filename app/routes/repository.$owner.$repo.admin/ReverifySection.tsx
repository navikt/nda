import { CheckmarkCircleIcon, ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, BodyShort, Box, Button, Detail, Heading, HStack, Loader, VStack } from '@navikt/ds-react'
import { useEffect, useState } from 'react'
import { Form, Link } from 'react-router'
import type { SyncJob } from '~/db/sync-job-types'

export type ReverifySectionProps = {
  repositoryId: number
  githubOwner: string
  githubRepoName: string
  computeDiffsJobStatus: SyncJob | null
}

export function ReverifySection({
  repositoryId,
  githubOwner,
  githubRepoName,
  computeDiffsJobStatus,
}: ReverifySectionProps) {
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])

  const lockExpired =
    hasMounted &&
    computeDiffsJobStatus?.lock_expires_at != null &&
    new Date(computeDiffsJobStatus.lock_expires_at) < new Date()

  const jobResult = computeDiffsJobStatus?.result as Record<string, number> | null

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Reverifisering
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Beregner verifiseringsavvik på nytt for alle apper knyttet til dette repositoryet. Bruker fortrinnsvis
            allerede lagret GitHub-data, men kan i noen tilfeller hente ferske data fra GitHub (f.eks. ved manglende
            eller foreldet cache).
          </BodyShort>
        </div>

        <HStack gap="space-16" align="center">
          <AkselLink
            as={Link}
            to={`/repository/${githubOwner}/${githubRepoName}/admin/verification-diff?repositoryId=${repositoryId}`}
          >
            Se verifiseringsavvik →
          </AkselLink>
        </HStack>

        <HStack gap="space-16" align="center">
          <Form method="post">
            <input type="hidden" name="action" value="compute_diffs" />
            <input type="hidden" name="repository_id" value={repositoryId} />
            <Button
              type="submit"
              size="small"
              variant="secondary"
              loading={computeDiffsJobStatus?.status === 'running'}
              disabled={computeDiffsJobStatus?.status === 'running'}
            >
              {computeDiffsJobStatus?.status === 'running' ? 'Reverifiserer...' : 'Reverifiser alle apper i repoet'}
            </Button>
          </Form>
          {computeDiffsJobStatus?.status === 'running' && (
            <Form method="post">
              <input type="hidden" name="action" value="cancel_compute_diffs_job" />
              <input type="hidden" name="repository_id" value={repositoryId} />
              <input type="hidden" name="job_id" value={computeDiffsJobStatus.id} />
              <Button type="submit" size="small" variant="danger">
                Stopp
              </Button>
            </Form>
          )}
          {computeDiffsJobStatus?.status === 'running' && lockExpired && (
            <Form method="post">
              <input type="hidden" name="action" value="force_release_compute_diffs_job" />
              <input type="hidden" name="repository_id" value={repositoryId} />
              <input type="hidden" name="job_id" value={computeDiffsJobStatus.id} />
              <Button type="submit" size="small" variant="danger">
                Tvangsfrigjør
              </Button>
            </Form>
          )}
        </HStack>

        {computeDiffsJobStatus && (
          <Box
            padding="space-12"
            borderRadius="4"
            background={
              computeDiffsJobStatus.status === 'completed'
                ? (jobResult?.appsSkippedLocked ?? 0) > 0
                  ? 'warning-soft'
                  : 'success-soft'
                : computeDiffsJobStatus.status === 'failed'
                  ? 'danger-soft'
                  : computeDiffsJobStatus.status === 'cancelled'
                    ? 'warning-soft'
                    : computeDiffsJobStatus.status === 'partial'
                      ? 'warning-soft'
                      : computeDiffsJobStatus.status === 'running'
                        ? 'info-soft'
                        : 'neutral-soft'
            }
            role="status"
            aria-live="polite"
          >
            <VStack gap="space-8">
              <HStack gap="space-8" align="center">
                {computeDiffsJobStatus.status === 'running' && (
                  <Loader size="xsmall" title="Reverifiserer deployments..." />
                )}
                {computeDiffsJobStatus.status === 'completed' &&
                  ((jobResult?.appsSkippedLocked ?? 0) > 0 ? (
                    <ExclamationmarkTriangleIcon aria-hidden />
                  ) : (
                    <CheckmarkCircleIcon aria-hidden />
                  ))}
                {computeDiffsJobStatus.status === 'failed' && <ExclamationmarkTriangleIcon aria-hidden />}
                {computeDiffsJobStatus.status === 'cancelled' && <ExclamationmarkTriangleIcon aria-hidden />}
                <BodyShort size="small" weight="semibold">
                  {computeDiffsJobStatus.status === 'pending' && 'Venter...'}
                  {computeDiffsJobStatus.status === 'running' && 'Reverifiserer...'}
                  {computeDiffsJobStatus.status === 'completed' &&
                    ((jobResult?.appsSkippedLocked ?? 0) > 0
                      ? 'Reverifisering fullført (med forbehold)'
                      : 'Reverifisering fullført')}
                  {computeDiffsJobStatus.status === 'failed' && 'Reverifisering feilet'}
                  {computeDiffsJobStatus.status === 'cancelled' && 'Reverifisering avbrutt'}
                </BodyShort>
              </HStack>

              {jobResult && (
                <HStack gap="space-16" wrap>
                  <Detail>
                    Apper prosessert: {jobResult.appsProcessed ?? 0} / {jobResult.appsTotal ?? 0}
                  </Detail>
                  <Detail>Deployments sjekket: {jobResult.deploymentsChecked ?? 0}</Detail>
                  <Detail>Avvik funnet: {jobResult.diffsFound ?? 0}</Detail>
                  {(jobResult.errors ?? 0) > 0 && (
                    <Detail>
                      <span style={{ color: 'var(--ax-text-danger)' }}>Feil: {jobResult.errors}</span>
                    </Detail>
                  )}
                  {(jobResult.appsSkippedLocked ?? 0) > 0 && (
                    <Detail>
                      <span style={{ color: 'var(--ax-text-warning)' }}>
                        Hoppet over pga. annen kjørende jobb: {jobResult.appsSkippedLocked} (ikke reverifisert — prøv
                        igjen senere)
                      </span>
                    </Detail>
                  )}
                </HStack>
              )}

              {computeDiffsJobStatus.status === 'failed' && computeDiffsJobStatus.error && (
                <BodyShort size="small">
                  <span style={{ color: 'var(--ax-text-danger)' }}>{computeDiffsJobStatus.error}</span>
                </BodyShort>
              )}

              <HStack gap="space-8" align="center">
                <Detail textColor="subtle">
                  Startet:{' '}
                  {computeDiffsJobStatus.started_at
                    ? new Date(computeDiffsJobStatus.started_at).toLocaleString('no-NO')
                    : 'N/A'}
                  {computeDiffsJobStatus.completed_at &&
                    ` • Fullført: ${new Date(computeDiffsJobStatus.completed_at).toLocaleString('no-NO')}`}
                </Detail>
                {computeDiffsJobStatus.id && (
                  <AkselLink
                    as={Link}
                    to={`/repository/${githubOwner}/${githubRepoName}/admin/sync-job/${computeDiffsJobStatus.id}?repositoryId=${repositoryId}`}
                  >
                    <Detail>Se logg →</Detail>
                  </AkselLink>
                )}
              </HStack>
            </VStack>
          </Box>
        )}
      </VStack>
    </Box>
  )
}
