import { BodyShort, Box, Detail, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import type { BoardObjectiveProgress } from '~/db/dashboard-stats.server'

export interface ActiveBoardData {
  id: number
  period_label: string
  period_type: 'tertiary' | 'quarterly' | 'monthly'
  period_start: string | Date
  period_end: string | Date
}

export interface ActiveBoardSectionProps {
  board: ActiveBoardData
  objectives: BoardObjectiveProgress[]
  teamBasePath: string
  /** Optional team name prepended to the board title (e.g. «Teamnavn — T1 2026») */
  teamName?: string
  /** Heading level for the board title. Defaults to "3". */
  headingLevel?: '2' | '3' | '4'
}

export function ActiveBoardSection({
  board,
  objectives,
  teamBasePath,
  teamName,
  headingLevel = '3',
}: ActiveBoardSectionProps) {
  const title = teamName ? `${teamName} — ${board.period_label}` : board.period_label
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <VStack gap="space-4">
          <Heading level={headingLevel} size="medium">
            <Link to={`${teamBasePath}/${board.id}`}>{title}</Link>
          </Heading>
          <HStack gap="space-8" align="center">
            <Tag variant="success" size="xsmall">
              Aktiv
            </Tag>
            <Detail textColor="subtle">
              {new Date(board.period_start).toLocaleDateString('nb-NO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
              {' – '}
              {new Date(board.period_end).toLocaleDateString('nb-NO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Detail>
          </HStack>
        </VStack>

        {objectives.length > 0 ? (
          <VStack gap="space-8">
            {objectives.map((obj) => (
              <Box key={obj.objective_id} padding="space-12" borderRadius="4" background="neutral-soft">
                <VStack gap="space-4">
                  <HStack justify="space-between" align="center">
                    <HStack gap="space-8" align="center" wrap>
                      <BodyShort weight="semibold" size="small">
                        {obj.objective_title}
                      </BodyShort>
                      {obj.dependabot_target && (
                        <Tag variant="moderate" size="xsmall" data-color="info">
                          🤖 Dependabot-mål
                        </Tag>
                      )}
                      {obj.keywords.length > 0 && (
                        <Detail textColor="subtle">Kode-ord: {obj.keywords.join(', ')}</Detail>
                      )}
                    </HStack>
                    <Tag variant="neutral" size="xsmall">
                      {obj.total_linked_deployments} deployments
                    </Tag>
                  </HStack>
                  {obj.key_results.length > 0 && (
                    <VStack gap="space-2">
                      {obj.key_results.map((kr) => (
                        <HStack key={kr.id} gap="space-8" align="center" justify="space-between">
                          <HStack gap="space-8" align="center" wrap>
                            <Detail>{kr.title}</Detail>
                            {kr.dependabot_target && (
                              <Tag variant="moderate" size="xsmall" data-color="info">
                                🤖 Dependabot-mål
                              </Tag>
                            )}
                            {kr.keywords.length > 0 && (
                              <Detail textColor="subtle">Kode-ord: {kr.keywords.join(', ')}</Detail>
                            )}
                          </HStack>
                          <Tag
                            variant="neutral"
                            size="xsmall"
                            data-color={kr.linked_deployments > 0 ? 'success' : 'neutral'}
                          >
                            {kr.linked_deployments}
                          </Tag>
                        </HStack>
                      ))}
                    </VStack>
                  )}
                </VStack>
              </Box>
            ))}
          </VStack>
        ) : (
          <BodyShort size="small" textColor="subtle">
            Ingen mål er opprettet for denne tavlen ennå.
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}
