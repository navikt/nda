import { BodyShort, Detail, HStack, LinkCard, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import type { BoardPeriodType } from '~/lib/board-periods'
import { formatBoardLabel } from '~/lib/board-periods'

export interface BoardSummaryObjective {
  objective_id: number
  objective_title: string
  total_linked_deployments: number
}

export interface BoardSummary {
  boardId: number
  periodLabel: string
  periodType: BoardPeriodType
  teamName: string
  teamSlug: string
  sectionSlug: string
  objectives: BoardSummaryObjective[]
}

export function BoardSummaryCard({
  board,
  linkedDeploymentCount,
}: {
  board: BoardSummary
  linkedDeploymentCount?: number
}) {
  const dashboardUrl = `/sections/${board.sectionSlug}/teams/${board.teamSlug}/dashboard?periodType=${board.periodType}&period=${encodeURIComponent(board.periodLabel)}`
  const totalDeployments =
    linkedDeploymentCount ?? board.objectives.reduce((sum, o) => sum + o.total_linked_deployments, 0)

  return (
    <LinkCard>
      <LinkCard.Title as="h3">
        <LinkCard.Anchor asChild>
          <Link to={dashboardUrl}>
            {formatBoardLabel({ teamName: board.teamName, periodLabel: board.periodLabel })}
          </Link>
        </LinkCard.Anchor>
      </LinkCard.Title>
      <LinkCard.Description>
        <VStack gap="space-12">
          <HStack>
            <Tag variant="moderate" size="xsmall" data-color="info">
              {totalDeployments} leveranser koblet
            </Tag>
          </HStack>
          {linkedDeploymentCount == null ? (
            board.objectives.length > 0 ? (
              <VStack gap="space-8">
                {board.objectives.map((obj) => (
                  <HStack key={obj.objective_id} gap="space-8" align="start">
                    <BodyShort size="small" style={{ flex: 1 }}>
                      {obj.objective_title}
                    </BodyShort>
                    <Tag
                      variant="moderate"
                      size="xsmall"
                      data-color={obj.total_linked_deployments > 0 ? 'success' : 'neutral'}
                    >
                      {obj.total_linked_deployments}
                    </Tag>
                  </HStack>
                ))}
              </VStack>
            ) : (
              <Detail textColor="subtle">Ingen mål er lagt til ennå.</Detail>
            )
          ) : null}
        </VStack>
      </LinkCard.Description>
    </LinkCard>
  )
}
