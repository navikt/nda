/**
 * Status History Page (App Admin)
 *
 * Shows deployments that have had status transitions (more than one entry in history).
 * Useful for finding deployments where verification results have changed over time.
 */

import { BodyShort, Box, Heading, Table, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { getDeploymentsWithStatusChanges } from '~/db/deployments.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { requireAdmin } from '~/lib/auth.server'
import { getFourEyesStatusLabel } from '~/lib/four-eyes-status'
import type { Route } from './+types/$team.env.$env.app.$app.admin.status-history'

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdmin(request)

  const app = await getMonitoredApplicationByIdentity(params.team, params.env, params.app)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const deployments = await getDeploymentsWithStatusChanges(app.id)

  return { app, deployments }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Statusoverganger' }]
}

function formatChangeSource(source: string): string {
  const labels: Record<string, string> = {
    verification: 'Verifisering',
    manual_approval: 'Manuell godkjenning',
    reverification: 'Reverifisering',
    sync: 'Synkronisering',
    legacy: 'Legacy',
    baseline_approval: 'Baseline godkjent',
    unknown: 'Ukjent',
  }
  return labels[source] || source
}

function getStatusVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  if (
    ['approved', 'approved_pr', 'manually_approved', 'implicitly_approved', 'baseline', 'no_changes'].includes(status)
  )
    return 'success'
  if (['pending', 'pending_baseline', 'legacy_pending', 'direct_push'].includes(status)) return 'warning'
  if (['unverified_commits', 'approved_pr_with_unreviewed', 'error', 'missing'].includes(status)) return 'error'
  return 'neutral'
}

export default function StatusHistoryPage({ loaderData }: Route.ComponentProps) {
  const { app, deployments } = loaderData
  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="medium" spacing>
          Statusoverganger
        </Heading>
        <BodyShort textColor="subtle">
          Deployments som har endret status mer enn én gang. Klikk på et deployment for å se full historikk.
        </BodyShort>
      </div>

      {deployments.length === 0 ? (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen deployments med flere statusoverganger.
          </BodyShort>
        </Box>
      ) : (
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Deployment</Table.HeaderCell>
              <Table.HeaderCell>Gjeldende status</Table.HeaderCell>
              <Table.HeaderCell>Siste overgang</Table.HeaderCell>
              <Table.HeaderCell>Kilde</Table.HeaderCell>
              <Table.HeaderCell align="right">Antall</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {deployments.map((dep) => (
              <Table.Row key={dep.deployment_id}>
                <Table.DataCell>
                  <Link to={`${appUrl}/deployments/${dep.deployment_id}`}>
                    {dep.title || dep.commit_sha?.substring(0, 7) || `#${dep.deployment_id}`}
                  </Link>
                  <BodyShort size="small" textColor="subtle">
                    {new Date(dep.created_at).toLocaleDateString('no-NO')}
                  </BodyShort>
                </Table.DataCell>
                <Table.DataCell>
                  <Tag variant={getStatusVariant(dep.four_eyes_status)} size="xsmall">
                    {getFourEyesStatusLabel(dep.four_eyes_status)}
                  </Tag>
                </Table.DataCell>
                <Table.DataCell>
                  {dep.latest_from_status && (
                    <>
                      <Tag variant={getStatusVariant(dep.latest_from_status)} size="xsmall">
                        {getFourEyesStatusLabel(dep.latest_from_status)}
                      </Tag>
                      {' → '}
                    </>
                  )}
                  <Tag variant={getStatusVariant(dep.latest_to_status)} size="xsmall">
                    {getFourEyesStatusLabel(dep.latest_to_status)}
                  </Tag>
                </Table.DataCell>
                <Table.DataCell>
                  <Tag variant="neutral" size="xsmall">
                    {formatChangeSource(dep.latest_change_source)}
                  </Tag>
                </Table.DataCell>
                <Table.DataCell align="right">{dep.transition_count}</Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}
