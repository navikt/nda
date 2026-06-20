import { ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, BodyShort, Box, Detail, Heading, HStack, Tag, ToggleGroup, VStack } from '@navikt/ds-react'
import { Link, useLoaderData, useSearchParams } from 'react-router'
import { getDeviationsByAppId } from '~/db/deviations.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { requireAdmin } from '~/lib/auth.server'
import {
  DEVIATION_FOLLOW_UP_ROLE_LABELS,
  DEVIATION_INTENT_LABELS,
  DEVIATION_SEVERITY_LABELS,
} from '~/lib/deviation-constants'
import type { Route } from './+types/$team.env.$env.app.$app.admin.deviations'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Avvik - Admin' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const { team, env, app: appName } = params
  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const url = new URL(request.url)
  const filter = url.searchParams.get('filter') || 'all'
  const resolved = filter === 'resolved' ? true : filter === 'open' ? false : undefined

  const deviations = await getDeviationsByAppId(app.id, { resolved })
  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  return { app, deviations, appUrl }
}

export default function AppDeviationsPage() {
  const { app, deviations, appUrl } = useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentFilter = searchParams.get('filter') || 'all'

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading level="1" size="large">
            Avvik for {app.app_name}
          </Heading>
          <BodyShort textColor="subtle">Registrerte avvik for deployments i {app.environment_name}.</BodyShort>
        </VStack>

        <ToggleGroup defaultValue={currentFilter} onChange={(value) => setSearchParams({ filter: value })} size="small">
          <ToggleGroup.Item value="all">Alle ({deviations.length})</ToggleGroup.Item>
          <ToggleGroup.Item value="open">Åpne</ToggleGroup.Item>
          <ToggleGroup.Item value="resolved">Løste</ToggleGroup.Item>
        </ToggleGroup>

        {deviations.length === 0 ? (
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen avvik funnet.
          </BodyShort>
        ) : (
          <VStack gap="space-12">
            {deviations.map((deviation) => (
              <Box
                key={deviation.id}
                padding="space-16"
                borderRadius="8"
                background="raised"
                borderColor={deviation.resolved_at ? 'neutral-subtle' : 'warning-subtle'}
                borderWidth="1"
              >
                <VStack gap="space-8">
                  <HStack gap="space-8" align="center" justify="space-between">
                    <HStack gap="space-8" align="center">
                      <ExclamationmarkTriangleIcon
                        aria-hidden
                        style={{
                          color: deviation.resolved_at ? 'var(--ax-text-neutral-subtle)' : 'var(--ax-text-warning)',
                        }}
                      />
                      <Detail textColor="subtle">
                        {new Date(deviation.created_at).toLocaleString('no-NO', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </Detail>
                      {deviation.resolved_at ? (
                        <Tag size="xsmall" variant="moderate" data-color="success">
                          Løst
                        </Tag>
                      ) : (
                        <Tag size="xsmall" variant="moderate" data-color="warning">
                          Åpen
                        </Tag>
                      )}
                    </HStack>
                    <Link to={`${appUrl}/deployments/${deviation.deployment_id}`}>
                      <AkselLink as="span">Deployment #{deviation.deployment_id}</AkselLink>
                    </Link>
                  </HStack>

                  <BodyShort>{deviation.reason}</BodyShort>

                  <HStack gap="space-12" wrap>
                    {deviation.breach_type && <Detail weight="semibold">{deviation.breach_type}</Detail>}
                    {deviation.severity && (
                      <Tag
                        size="xsmall"
                        variant="moderate"
                        data-color={
                          deviation.severity === 'critical' || deviation.severity === 'high'
                            ? 'danger'
                            : deviation.severity === 'medium'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {DEVIATION_SEVERITY_LABELS[deviation.severity]}
                      </Tag>
                    )}
                    {deviation.intent && (
                      <Detail textColor="subtle">Intensjon: {DEVIATION_INTENT_LABELS[deviation.intent]}</Detail>
                    )}
                    {deviation.follow_up_role && (
                      <Detail textColor="subtle">
                        Oppfølging: {DEVIATION_FOLLOW_UP_ROLE_LABELS[deviation.follow_up_role]}
                      </Detail>
                    )}
                  </HStack>

                  <Detail textColor="subtle">
                    Registrert av {deviation.registered_by_name || deviation.registered_by}
                    {deviation.title && ` — ${deviation.title}`}
                  </Detail>

                  {deviation.resolved_at && (
                    <Detail textColor="subtle">
                      Løst{' '}
                      {new Date(deviation.resolved_at).toLocaleString('no-NO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {deviation.resolved_by_name && ` av ${deviation.resolved_by_name}`}
                      {deviation.resolution_note && ` — ${deviation.resolution_note}`}
                    </Detail>
                  )}
                </VStack>
              </Box>
            ))}
          </VStack>
        )}
      </VStack>
    </Box>
  )
}
