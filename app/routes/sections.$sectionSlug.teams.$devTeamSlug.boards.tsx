import { ArrowLeftIcon } from '@navikt/aksel-icons'
import { BodyShort, Button, Heading, Table, Tag, VStack } from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { type Board, getBoardsByDevTeam } from '~/db/boards.server'
import { getDevTeamBySlug } from '~/db/dev-teams.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import { BOARD_PERIOD_TYPE_LABELS, formatBoardLabel } from '~/lib/board-periods'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.boards'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Tidligere tavler – ${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const boards = await getBoardsByDevTeam(devTeam.id)
  const inactiveBoards = boards.filter((b) => !b.is_active)

  const section = await getSectionBySlug(params.sectionSlug)

  return {
    devTeam,
    inactiveBoards,
    sectionSlug: params.sectionSlug,
    sectionName: section?.name ?? params.sectionSlug,
  }
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
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {inactiveBoards.map((board) => (
              <BoardRow key={board.id} board={board} teamBasePath={teamBasePath} teamName={devTeam.name} />
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}

function BoardRow({ board, teamBasePath, teamName }: { board: Board; teamBasePath: string; teamName: string }) {
  return (
    <Table.Row>
      <Table.DataCell>
        <Link to={`${teamBasePath}/${board.id}`}>
          {formatBoardLabel({ teamName, periodLabel: board.period_label })}
        </Link>
      </Table.DataCell>
      <Table.DataCell>
        <Tag variant="neutral" size="small">
          {BOARD_PERIOD_TYPE_LABELS[board.period_type] ?? board.period_type}
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
