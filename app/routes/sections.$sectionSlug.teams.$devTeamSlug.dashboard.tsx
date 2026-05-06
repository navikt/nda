import { LinkIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Detail, Heading, HStack, Select, Tag, VStack } from '@navikt/ds-react'
import { Link, useLoaderData, useSearchParams } from 'react-router'
import { getBoardsByDevTeam } from '~/db/boards.server'
import { type BoardObjectiveProgress, getBoardObjectiveProgress, getDevTeamStats } from '~/db/dashboard-stats.server'
import { getDevTeamBySlug } from '~/db/dev-teams.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import { type BoardPeriodType, formatBoardLabel, getCurrentPeriod, getPeriodsForYear } from '~/lib/board-periods'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.dashboard'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Dashboard – ${data?.devTeam?.name ?? 'Team'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) throw new Response('Utviklingsteam ikke funnet', { status: 404 })

  const url = new URL(request.url)
  const periodType = (url.searchParams.get('periodType') as BoardPeriodType) || 'tertiary'
  const periodLabel = url.searchParams.get('period') || getCurrentPeriod(periodType).label

  const year = new Date().getFullYear()
  const periods = getPeriodsForYear(periodType, year)
  const selectedPeriod = periods.find((p) => p.label === periodLabel) ?? getCurrentPeriod(periodType)

  const boards = await getBoardsByDevTeam(devTeam.id)
  const currentBoard = boards.find((b) => b.period_label === selectedPeriod.label && b.period_type === periodType)

  // Use board's actual dates when available, otherwise fall back to calculated period.
  // This ensures the dashboard matches the team page's board section.
  const startDate = currentBoard ? new Date(currentBoard.period_start) : new Date(selectedPeriod.start)
  const endDate = currentBoard ? new Date(currentBoard.period_end) : new Date(selectedPeriod.end)
  endDate.setDate(endDate.getDate() + 1)

  let objectiveProgress: BoardObjectiveProgress[] = []
  if (currentBoard) {
    objectiveProgress = (await getBoardObjectiveProgress(currentBoard.id, undefined, { startDate })).objectives
  }

  // Use board-based team stats for consistent counting with the team page and section page
  const teamStats = await getDevTeamStats(devTeam.id, startDate, endDate)
  const coverage = {
    total: teamStats.total_deployments,
    with_four_eyes: teamStats.with_four_eyes,
    four_eyes_percentage:
      teamStats.total_deployments > 0
        ? floorUnlessPerfect((teamStats.with_four_eyes / teamStats.total_deployments) * 100)
        : 0,
    with_origin: teamStats.linked_to_goal,
    origin_percentage:
      teamStats.total_deployments > 0
        ? floorUnlessPerfect((teamStats.linked_to_goal / teamStats.total_deployments) * 100)
        : 0,
  }

  const section = await getSectionBySlug(params.sectionSlug)

  return {
    devTeam,
    periods,
    selectedPeriod,
    periodType,
    currentBoard,
    objectiveProgress,
    coverage,
    sectionSlug: params.sectionSlug,
    sectionName: section?.name ?? params.sectionSlug,
  }
}

export default function DevTeamDashboard() {
  const { devTeam, periods, selectedPeriod, periodType, currentBoard, objectiveProgress, coverage, sectionSlug } =
    useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`

  return (
    <VStack gap="space-24">
      <Heading level="1" size="large" spacing>
        Dashboard – {devTeam.name}
      </Heading>

      {/* Period selector */}
      <HStack gap="space-16" wrap>
        <Select
          label="Periodetype"
          size="small"
          value={periodType}
          onChange={(e) => {
            const params = new URLSearchParams(searchParams)
            params.set('periodType', e.target.value)
            params.delete('period')
            setSearchParams(params)
          }}
        >
          <option value="tertiary">Tertial</option>
          <option value="quarterly">Kvartal</option>
        </Select>
        <Select
          label="Periode"
          size="small"
          value={selectedPeriod.label}
          onChange={(e) => {
            const params = new URLSearchParams(searchParams)
            params.set('period', e.target.value)
            setSearchParams(params)
          }}
        >
          {periods.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </Select>
      </HStack>

      {/* Coverage summary */}
      <Box padding="space-20" borderRadius="8" background="neutral-soft">
        <HStack gap="space-32" wrap>
          <VStack gap="space-4">
            <Detail textColor="subtle">Totalt deployments</Detail>
            <Heading size="medium" level="3">
              {coverage.total}
            </Heading>
          </VStack>
          <VStack gap="space-4">
            <Detail textColor="subtle">4-øyne-dekning</Detail>
            <Tag variant={getCoverageVariant(coverage.four_eyes_percentage / 100)} size="medium">
              {coverage.four_eyes_percentage}%
            </Tag>
          </VStack>
          <VStack gap="space-4">
            <Detail textColor="subtle">Endringsopphav</Detail>
            <Tag variant={getCoverageVariant(coverage.origin_percentage / 100)} size="medium">
              {coverage.origin_percentage}%
            </Tag>
          </VStack>
          <VStack gap="space-4">
            <Detail textColor="subtle">Uten kobling</Detail>
            <BodyShort weight="semibold">{coverage.total - coverage.with_origin}</BodyShort>
          </VStack>
        </HStack>
        <Detail textColor="subtle" spacing>
          Inkluderer leveranser koblet til teamets måltavle og ukoblede leveranser fra teammedlemmer med GitHub-kobling.
        </Detail>
      </Box>

      {/* Board objective progress */}
      {!currentBoard ? (
        <Alert variant="info">
          Ingen tavle funnet for {selectedPeriod.label}. <Link to={teamBasePath}>Opprett en tavle</Link>
        </Alert>
      ) : (
        <VStack gap="space-16">
          <Heading level="2" size="medium">
            Mål-fremdrift – {formatBoardLabel({ teamName: devTeam.name, periodLabel: currentBoard.period_label })}
          </Heading>

          {objectiveProgress.length === 0 ? (
            <Alert variant="info">
              Ingen mål er lagt til på denne tavlen. <Link to={`${teamBasePath}/${currentBoard.id}`}>Legg til mål</Link>
            </Alert>
          ) : (
            <VStack gap="space-12">
              {objectiveProgress.map((obj) => (
                <ObjectiveProgressCard key={obj.objective_id} objective={obj} />
              ))}
            </VStack>
          )}
        </VStack>
      )}
    </VStack>
  )
}

function ObjectiveProgressCard({ objective }: { objective: BoardObjectiveProgress }) {
  return (
    <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-12">
        <HStack justify="space-between" align="center">
          <Heading level="3" size="small">
            {objective.objective_title}
          </Heading>
          <HStack gap="space-8" align="center">
            <LinkIcon aria-hidden />
            <Tag variant={objective.total_linked_deployments > 0 ? 'info' : 'neutral'} size="small">
              {objective.total_linked_deployments} leveranser
            </Tag>
          </HStack>
        </HStack>

        {objective.key_results.length > 0 && (
          <VStack gap="space-8">
            {objective.key_results.map((kr) => (
              <HStack key={kr.id} justify="space-between" align="center">
                <BodyShort size="small">{kr.title}</BodyShort>
                <Tag variant={kr.linked_deployments > 0 ? 'info' : 'neutral'} size="xsmall">
                  {kr.linked_deployments} leveranser
                </Tag>
              </HStack>
            ))}
          </VStack>
        )}
      </VStack>
    </Box>
  )
}

function getCoverageVariant(ratio: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (ratio >= 0.9) return 'success'
  if (ratio >= 0.7) return 'warning'
  if (ratio > 0) return 'error'
  return 'neutral'
}

function floorUnlessPerfect(pct: number): number {
  if (pct >= 100) return 100
  return Math.floor(pct)
}
