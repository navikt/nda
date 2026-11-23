import { ArrowLeftIcon } from '@navikt/aksel-icons'
import { BodyShort, Button, Heading, Link, Table, Tag, VStack } from '@navikt/ds-react'
import { Link as RouterLink } from 'react-router'
import type { Board } from '~/db/boards.server'
import { BOARD_PERIOD_TYPE_LABELS, formatBoardLabel } from '~/lib/board-periods'

export interface TeamBoardsPageProps {
  devTeam: { name: string; slug: string }
  boards: Pick<Board, 'id' | 'period_label' | 'period_type' | 'period_start' | 'period_end' | 'is_active'>[]
  sectionSlug: string
}

export function TeamBoardsPage({ devTeam, boards, sectionSlug }: TeamBoardsPageProps) {
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`

  return (
    <VStack gap="space-24">
      <div>
        <Button as={RouterLink} to={teamBasePath} variant="tertiary" size="small" icon={<ArrowLeftIcon aria-hidden />}>
          Tilbake til {devTeam.name}
        </Button>
        <Heading level="1" size="large" spacing>
          Alle tavler
        </Heading>
        <BodyShort textColor="subtle">{devTeam.name}</BodyShort>
      </div>

      {boards.length === 0 ? (
        <BodyShort textColor="subtle">Ingen tavler er opprettet ennå.</BodyShort>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tavle</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Periode</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {boards.map((board) => (
              <Table.Row key={board.id}>
                <Table.DataCell>
                  <Link as={RouterLink} to={`${teamBasePath}/${board.id}`}>
                    {formatBoardLabel({ teamName: devTeam.name, periodLabel: board.period_label })}
                  </Link>
                </Table.DataCell>
                <Table.DataCell>{BOARD_PERIOD_TYPE_LABELS[board.period_type] ?? board.period_type}</Table.DataCell>
                <Table.DataCell>
                  {new Date(board.period_start).toLocaleDateString('nb-NO')}
                  {' – '}
                  {new Date(board.period_end).toLocaleDateString('nb-NO')}
                </Table.DataCell>
                <Table.DataCell>
                  <Tag variant={board.is_active ? 'success' : 'neutral'} size="small">
                    {board.is_active ? 'Aktiv' : 'Avsluttet'}
                  </Tag>
                </Table.DataCell>
                <Table.DataCell>
                  <Button as={RouterLink} to={`${teamBasePath}/${board.id}`} variant="tertiary" size="xsmall">
                    Vis
                  </Button>
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}
