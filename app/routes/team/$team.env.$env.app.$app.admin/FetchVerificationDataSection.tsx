import { CheckmarkCircleIcon, ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Label,
  Loader,
  Switch,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useState } from 'react'
import { Form, Link } from 'react-router'
import type { SyncJob } from '~/db/sync-jobs.server'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

export type FetchVerificationDataSectionProps = {
  app: LoaderData['app']
  githubDataStats: LoaderData['githubDataStats']
  fetchJobStatus: SyncJob | null
}

export function FetchVerificationDataSection({
  app,
  githubDataStats,
  fetchJobStatus,
}: FetchVerificationDataSectionProps) {
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])

  const lockExpired =
    hasMounted && fetchJobStatus?.lock_expires_at != null && new Date(fetchJobStatus.lock_expires_at) < new Date()

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Hent verifiseringsdata fra GitHub
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Henter og lagrer data fra GitHub for alle deployments. Kjører kun for deployments som mangler data eller har
            utdatert schema-versjon.
          </BodyShort>
        </div>

        {/* GitHub Data Stats */}
        <Box padding="space-16" borderRadius="4" background="neutral-soft">
          <VStack gap="space-8">
            <Label size="small">
              GitHub data-dekning{app.audit_start_year ? ` (fra ${app.audit_start_year})` : ''}
            </Label>
            <HStack gap="space-24" wrap>
              <div>
                <Detail textColor="subtle">Totalt deployments</Detail>
                <BodyShort weight="semibold">{githubDataStats.total}</BodyShort>
              </div>
              <div>
                <Detail textColor="subtle">Med GitHub-data</Detail>
                <BodyShort weight="semibold" style={{ color: 'var(--ax-text-success)' }}>
                  {githubDataStats.withCurrentData}
                </BodyShort>
              </div>
              {githubDataStats.withOutdatedData > 0 && (
                <div>
                  <Detail textColor="subtle">Utdatert data</Detail>
                  <BodyShort weight="semibold" style={{ color: 'var(--ax-text-warning)' }}>
                    {githubDataStats.withOutdatedData}
                  </BodyShort>
                </div>
              )}
              <div>
                <Detail textColor="subtle">Mangler data</Detail>
                <BodyShort
                  weight="semibold"
                  style={{
                    color: githubDataStats.withoutData > 0 ? 'var(--ax-text-danger)' : 'var(--ax-text-neutral-subtle)',
                  }}
                >
                  {githubDataStats.withoutData}
                </BodyShort>
              </div>
              {githubDataStats.total > 0 && (
                <div>
                  <Detail textColor="subtle">Dekning</Detail>
                  <BodyShort weight="semibold">
                    {Math.round((githubDataStats.withCurrentData / githubDataStats.total) * 100)}%
                  </BodyShort>
                </div>
              )}
            </HStack>
          </VStack>
        </Box>

        <HStack gap="space-16" align="center">
          <Form method="post">
            <input type="hidden" name="action" value="fetch_verification_data" />
            <input type="hidden" name="app_id" value={app.id} />
            <HStack gap="space-12" align="center">
              <Button
                type="submit"
                size="small"
                variant="secondary"
                loading={fetchJobStatus?.status === 'running'}
                disabled={fetchJobStatus?.status === 'running'}
              >
                {fetchJobStatus?.status === 'running' ? 'Henter data...' : 'Hent data for alle deployments'}
              </Button>
              {fetchJobStatus?.status !== 'running' && (
                <Switch size="small" name="debug">
                  Debug-logging
                </Switch>
              )}
            </HStack>
          </Form>
          {fetchJobStatus?.status === 'running' && (
            <Form method="post">
              <input type="hidden" name="action" value="cancel_fetch_job" />
              <input type="hidden" name="job_id" value={fetchJobStatus.id} />
              <Button type="submit" size="small" variant="danger">
                Stopp
              </Button>
            </Form>
          )}
          {fetchJobStatus?.status === 'running' && lockExpired && (
            <Form method="post">
              <input type="hidden" name="action" value="force_release_job" />
              <input type="hidden" name="job_id" value={fetchJobStatus.id} />
              <Button type="submit" size="small" variant="danger">
                Tvangsfrigjør
              </Button>
            </Form>
          )}
        </HStack>

        {fetchJobStatus && (
          <Box
            padding="space-12"
            borderRadius="4"
            background={
              fetchJobStatus.status === 'completed'
                ? 'success-soft'
                : fetchJobStatus.status === 'failed'
                  ? 'danger-soft'
                  : fetchJobStatus.status === 'cancelled'
                    ? 'warning-soft'
                    : fetchJobStatus.status === 'running'
                      ? 'info-soft'
                      : 'neutral-soft'
            }
          >
            <VStack gap="space-8">
              <HStack gap="space-8" align="center">
                {fetchJobStatus.status === 'running' && <Loader size="xsmall" />}
                {fetchJobStatus.status === 'completed' && <CheckmarkCircleIcon aria-hidden />}
                {fetchJobStatus.status === 'failed' && <ExclamationmarkTriangleIcon aria-hidden />}
                {fetchJobStatus.status === 'cancelled' && <ExclamationmarkTriangleIcon aria-hidden />}
                <BodyShort size="small" weight="semibold">
                  {fetchJobStatus.status === 'pending' && 'Venter...'}
                  {fetchJobStatus.status === 'running' && 'Henter data fra GitHub...'}
                  {fetchJobStatus.status === 'completed' && 'Datahenting fullført'}
                  {fetchJobStatus.status === 'failed' && 'Datahenting feilet'}
                  {fetchJobStatus.status === 'cancelled' && 'Datahenting avbrutt'}
                </BodyShort>
              </HStack>

              {/* Progress counters (shown for running AND terminal states) */}
              {fetchJobStatus.result && (
                <HStack gap="space-16" wrap>
                  <Detail>
                    Prosessert: {(fetchJobStatus.result as Record<string, number>).processed ?? 0} /{' '}
                    {(fetchJobStatus.result as Record<string, number>).total ?? 0}
                  </Detail>
                  <Detail>Hentet: {(fetchJobStatus.result as Record<string, number>).fetched ?? 0}</Detail>
                  <Detail>Hoppet over: {(fetchJobStatus.result as Record<string, number>).skipped ?? 0}</Detail>
                  {((fetchJobStatus.result as Record<string, number>).errors ?? 0) > 0 && (
                    <Detail>
                      <span style={{ color: 'var(--ax-text-danger)' }}>
                        Feil: {(fetchJobStatus.result as Record<string, number>).errors}
                      </span>
                    </Detail>
                  )}
                </HStack>
              )}

              {fetchJobStatus.status === 'failed' && fetchJobStatus.error && (
                <BodyShort size="small">
                  <span style={{ color: 'var(--ax-text-danger)' }}>{fetchJobStatus.error}</span>
                </BodyShort>
              )}

              <HStack gap="space-8" align="center">
                <Detail textColor="subtle">
                  Startet:{' '}
                  {fetchJobStatus.started_at ? new Date(fetchJobStatus.started_at).toLocaleString('no-NO') : 'N/A'}
                  {fetchJobStatus.completed_at &&
                    ` • Fullført: ${new Date(fetchJobStatus.completed_at).toLocaleString('no-NO')}`}
                </Detail>
                {fetchJobStatus.id && (
                  <AkselLink
                    as={Link}
                    to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/sync-job/${fetchJobStatus.id}`}
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
