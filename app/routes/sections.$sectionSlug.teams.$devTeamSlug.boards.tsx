import { ArrowLeftIcon } from '@navikt/aksel-icons'
import { BodyShort, Button, Heading, Table, Tag, VStack } from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { type Board, getBoardsByDevTeam } from '~/db/boards.server'
import { getDevTeamBySlug } from '~/db/dev-teams.server'
import { requireUser } from '~/lib/auth.server'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.boards'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Tidligere tavler – ${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const boards = await getBoardsByDevTeam(devTeam.id)
  const inactiveBoards = boards.filter((b) => !b.is_active)

  return { devTeam, inactiveBoards, sectionSlug: params.sectionSlug }
}

export default function BoardHistory() {
  const { devTeam, inactiveBoards, sectionSlug } = useLoaderData<typeof loader>()
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`

  return (
    <VStack gap="space-24">
      <div>
        <Button as={Link} to={teamBasePath} variant="tertiary" size="small" icon={<ArrowLeftIcon aria-hidden />}>
          Tilbake til {devTeam.name}
        </Button>
        <Heading level="1" size="large" spacing>
          Tidligere tavler
        </Heading>
        <BodyShort textColor="subtle">{devTeam.name}</BodyShort>
      </div>

      {inactiveBoards.length === 0 ? (
        <BodyShort textColor="subtle">Ingen avsluttede tavler.</BodyShort>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tavle</Table.HeaderCell>
              <Table.HeaderCell>Periode</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {inactiveBoards.map((board) => (
              <BoardRow key={board.id} board={board} teamBasePath={teamBasePath} />
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}

function BoardRow({ board, teamBasePath }: { board: Board; teamBasePath: string }) {
  return (
    <Table.Row>
      <Table.DataCell>
        <Link to={`${teamBasePath}/${board.id}`}>{board.title}</Link>
      </Table.DataCell>
      <Table.DataCell>{board.period_label}</Table.DataCell>
      <Table.DataCell>
        <Tag variant="neutral" size="small">
          {board.period_type === 'tertiary' ? 'Tertial' : 'Kvartal'}
        </Tag>
      </Table.DataCell>
      <Table.DataCell>
        <Button as={Link} to={`${teamBasePath}/${board.id}`} variant="tertiary" size="xsmall">
          Vis
        </Button>
      </Table.DataCell>
    </Table.Row>
  )
}
