import { BodyShort, Box, Heading, Table, VStack } from '@navikt/ds-react'
import { useLoaderData } from 'react-router'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/debug-dev-team-application-groups'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Debug: dev_team_application_groups - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { rows } = await pool.query<{
    dev_team_id: number
    application_group_id: number
    created_at: string
    deleted_at: string | null
  }>('SELECT dev_team_id, application_group_id, created_at, deleted_at FROM dev_team_application_groups')

  return { rows, total: rows.length }
}

export default function DebugDevTeamApplicationGroupsPage() {
  const { rows, total } = useLoaderData<typeof loader>()

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-24">
        <div>
          <Heading level="1" size="large" spacing>
            Debug: dev_team_application_groups
          </Heading>
          <BodyShort textColor="subtle">
            Midlertidig side for å sjekke innholdet i tabellen dev_team_application_groups. Fjernes etter bruk. Antall
            rader: {total}.
          </BodyShort>
        </div>

        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>dev_team_id</Table.HeaderCell>
              <Table.HeaderCell>application_group_id</Table.HeaderCell>
              <Table.HeaderCell>created_at</Table.HeaderCell>
              <Table.HeaderCell>deleted_at</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => (
              <Table.Row key={`${r.dev_team_id}-${r.application_group_id}`}>
                <Table.DataCell>{r.dev_team_id}</Table.DataCell>
                <Table.DataCell>{r.application_group_id}</Table.DataCell>
                <Table.DataCell>{r.created_at}</Table.DataCell>
                <Table.DataCell>{r.deleted_at ?? '-'}</Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {rows.length === 0 && <BodyShort textColor="subtle">Tabellen er tom.</BodyShort>}
      </VStack>
    </Box>
  )
}
