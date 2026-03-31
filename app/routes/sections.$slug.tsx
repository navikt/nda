import {
  BarChartIcon,
  CheckmarkCircleIcon,
  ExclamationmarkTriangleIcon,
  LinkIcon,
  PencilIcon,
} from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  HStack,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import type { DevTeamDashboardStats } from '~/db/dashboard-stats.server'
import { getSectionDashboardStats, getSectionOverallStats } from '~/db/dashboard-stats.server'
import { getDevTeamsBySection } from '~/db/dev-teams.server'
import { getSectionBySlug } from '~/db/sections.server'
import { requireUser } from '~/lib/auth.server'
import type { Route } from './+types/sections.$slug'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.section?.name ?? 'Seksjon'} – Oversikt` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const section = await getSectionBySlug(params.slug)
  if (!section) throw new Response('Seksjon ikke funnet', { status: 404 })

  const ytdStart = new Date(new Date().getFullYear(), 0, 1)

  const [allTimeStats, ytdStats, ytdTeamStats, devTeams] = await Promise.all([
    getSectionOverallStats(section.id),
    getSectionOverallStats(section.id, ytdStart),
    getSectionDashboardStats(section.id, ytdStart),
    getDevTeamsBySection(section.id),
  ])

  return {
    section,
    allTimeStats,
    ytdDeployments: ytdStats.total_deployments,
    ytdTeamStats,
    devTeams,
    isAdmin: user.role === 'admin',
  }
}

export default function SectionOverview() {
  const { section, allTimeStats, ytdDeployments, ytdTeamStats, devTeams, isAdmin } = useLoaderData<typeof loader>()

  const overallFourEyes = allTimeStats.four_eyes_coverage
  const overallGoalCoverage = allTimeStats.goal_coverage

  return (
    <VStack gap="space-32">
      <div>
        <HStack justify="space-between" align="center">
          <Heading level="1" size="xlarge" spacing>
            {section.name}
          </Heading>
          {isAdmin && (
            <Button
              as={Link}
              to={`/sections/${section.slug}/edit`}
              variant="tertiary"
              size="small"
              icon={<PencilIcon aria-hidden />}
            >
              Rediger
            </Button>
          )}
        </HStack>
        <BodyShort textColor="subtle">Seksjonsoversikt – helsetilstand for SDLC governance</BodyShort>
      </div>

      {/* Summary cards */}
      <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
        <SummaryCard title="Deployments i år" value={ytdDeployments} icon={<BarChartIcon aria-hidden />} />
        <SummaryCard
          title="4-øyne dekning"
          value={formatCoverage(overallFourEyes)}
          icon={<CheckmarkCircleIcon aria-hidden />}
          variant={getHealthVariant(overallFourEyes)}
        />
        <SummaryCard
          title="Endringsopphav"
          value={formatCoverage(overallGoalCoverage)}
          icon={<LinkIcon aria-hidden />}
          variant={getHealthVariant(overallGoalCoverage)}
        />
        <SummaryCard
          title="Samlet helsetilstand"
          value={getHealthLabel(overallFourEyes, overallGoalCoverage)}
          icon={getHealthIcon(overallFourEyes, overallGoalCoverage)}
          variant={getHealthVariant(Math.min(overallFourEyes, overallGoalCoverage))}
        />
      </HGrid>

      {/* Dev team breakdown */}
      <VStack gap="space-16">
        <Heading level="2" size="large">
          Utviklingsteam
        </Heading>
        {devTeams.length === 0 ? (
          <Alert variant="info">
            Ingen utviklingsteam er opprettet.{' '}
            <AkselLink as={Link} to={`/sections/${section.slug}/edit`}>
              Opprett utviklingsteam
            </AkselLink>
          </Alert>
        ) : (
          <VStack gap="space-12">
            {ytdTeamStats.map((teamStats) => (
              <DevTeamCard key={teamStats.dev_team_id} stats={teamStats} sectionSlug={section.slug} />
            ))}
          </VStack>
        )}
      </VStack>
    </VStack>
  )
}

/** Format coverage percentage — never shows 100% if there are violations */
function formatCoverage(ratio: number): string {
  const pct = ratio * 100
  if (pct > 0 && pct < 1) return '<1%'
  if (pct > 99 && pct < 100) return '99%'
  return `${Math.round(pct)}%`
}

function SummaryCard({
  title,
  value,
  icon,
  variant = 'neutral',
}: {
  title: string
  value: string | number
  icon: React.ReactNode
  variant?: 'success' | 'warning' | 'error' | 'neutral'
}) {
  const bgMap = {
    success: 'success-soft' as const,
    warning: 'warning-soft' as const,
    error: 'danger-soft' as const,
    neutral: 'neutral-soft' as const,
  }

  return (
    <Box padding="space-20" borderRadius="8" background={bgMap[variant]}>
      <VStack gap="space-4">
        <HStack gap="space-8" align="center">
          {icon}
          <Detail textColor="subtle">{title}</Detail>
        </HStack>
        <Heading size="large" level="3">
          {value}
        </Heading>
      </VStack>
    </Box>
  )
}

function DevTeamCard({ stats, sectionSlug }: { stats: DevTeamDashboardStats; sectionSlug: string }) {
  const fourEyesPct = formatCoverage(stats.four_eyes_coverage)
  const goalPct = formatCoverage(stats.goal_coverage)

  return (
    <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <HStack justify="space-between" align="start" wrap>
        <VStack gap="space-8">
          <Heading level="3" size="medium">
            <Link to={`/sections/${sectionSlug}/teams/${stats.dev_team_slug}`}>{stats.dev_team_name}</Link>
          </Heading>
        </VStack>

        <HStack gap="space-24" wrap>
          <VStack gap="space-4" align="center">
            <Detail textColor="subtle">Deployments i år</Detail>
            <BodyShort weight="semibold">{stats.total_deployments}</BodyShort>
          </VStack>
          <VStack gap="space-4" align="center">
            <Detail textColor="subtle">4-øyne</Detail>
            <Tag variant={getHealthVariant(stats.four_eyes_coverage)} size="small">
              {fourEyesPct}
            </Tag>
          </VStack>
          <VStack gap="space-4" align="center">
            <Detail textColor="subtle">Endringsopphav</Detail>
            <Tag variant={getHealthVariant(stats.goal_coverage)} size="small">
              {goalPct}
            </Tag>
          </VStack>
          <VStack gap="space-4" align="center">
            <Detail textColor="subtle">Uten 4-øyne</Detail>
            <Tag variant={stats.without_four_eyes > 0 ? 'warning' : 'neutral'} size="small">
              {stats.without_four_eyes}
            </Tag>
          </VStack>
        </HStack>
      </HStack>
    </Box>
  )
}

function getHealthVariant(ratio: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (ratio >= 0.9) return 'success'
  if (ratio >= 0.7) return 'warning'
  if (ratio > 0) return 'error'
  return 'neutral'
}

function getHealthLabel(fourEyes: number, goalCoverage: number): string {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 0.9) return 'God'
  if (min >= 0.7) return 'Akseptabel'
  if (min > 0) return 'Trenger oppfølging'
  return 'Ingen data'
}

function getHealthIcon(fourEyes: number, goalCoverage: number): React.ReactNode {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 0.7) return <CheckmarkCircleIcon aria-hidden />
  return <ExclamationmarkTriangleIcon aria-hidden />
}
