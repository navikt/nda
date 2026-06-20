import { BarChartIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, LinkIcon, PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, Tag, TextField, VStack } from '@navikt/ds-react'
import { type ReactNode, useState } from 'react'
import { Form, Link, useLoaderData } from 'react-router'
import { getDevTeamStatsBatch } from '~/db/dashboard-stats.server'
import { createSection, getAllSectionsWithTeams, type SectionWithTeams } from '~/db/sections.server'
import { requireAdmin, requireUser } from '~/lib/auth.server'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/sections'

export function meta() {
  return [{ title: 'Seksjoner – NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const allSections = await getAllSectionsWithTeams()
  const ytdStart = new Date(new Date().getFullYear(), 0, 1)

  const { getAllDevTeams } = await import('~/db/dev-teams.server')
  const allDevTeams = await getAllDevTeams()
  const allDevTeamIds = allDevTeams.map((t) => t.id)
  const teamStatsMap = await getDevTeamStatsBatch(allDevTeamIds, ytdStart)

  const teamsBySection = new Map<number, typeof allDevTeams>()
  for (const team of allDevTeams) {
    const list = teamsBySection.get(team.section_id) ?? []
    list.push(team)
    teamsBySection.set(team.section_id, list)
  }

  const sections = allSections.map((s) => {
    const sectionTeams = teamsBySection.get(s.id) ?? []
    let totalDeployments = 0
    let withFourEyes = 0
    let linkedToGoal = 0
    for (const team of sectionTeams) {
      const stats = teamStatsMap.get(team.id)
      if (stats) {
        totalDeployments += stats.total_deployments
        withFourEyes += stats.with_four_eyes
        linkedToGoal += stats.linked_to_goal
      }
    }
    return {
      ...s,
      stats: {
        total_deployments: totalDeployments,
        with_four_eyes: withFourEyes,
        linked_to_goal: linkedToGoal,
        four_eyes_coverage: totalDeployments > 0 ? withFourEyes / totalDeployments : 0,
        goal_coverage: totalDeployments > 0 ? linkedToGoal / totalDeployments : 0,
      },
    }
  })

  const aggregate = sections.reduce(
    (acc, s) => ({
      total_deployments: acc.total_deployments + s.stats.total_deployments,
      with_four_eyes: acc.with_four_eyes + s.stats.with_four_eyes,
      linked_to_goal: acc.linked_to_goal + s.stats.linked_to_goal,
    }),
    { total_deployments: 0, with_four_eyes: 0, linked_to_goal: 0 },
  )

  const fourEyesCoverage = aggregate.total_deployments > 0 ? aggregate.with_four_eyes / aggregate.total_deployments : 0
  const goalCoverage = aggregate.total_deployments > 0 ? aggregate.linked_to_goal / aggregate.total_deployments : 0

  return {
    isAdmin: user.role === 'admin',
    sections,
    overallStats: { fourEyesCoverage, goalCoverage },
    ytdDeployments: aggregate.total_deployments,
  }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create') {
    const slug = (formData.get('slug') as string)?.trim()
    const name = (formData.get('name') as string)?.trim()
    const entraGroupAdmin = (formData.get('entra_group_admin') as string)?.trim() || undefined
    const entraGroupUser = (formData.get('entra_group_user') as string)?.trim() || undefined

    if (!slug || !name) {
      return { error: 'Slug og navn er påkrevd.' }
    }

    try {
      await createSection(slug, name, entraGroupAdmin, entraGroupUser)
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke opprette seksjon: ${error}` }
    }
  }

  return { error: 'Ukjent handling.' }
}

export default function AdminSections() {
  const { sections, isAdmin, overallStats, ytdDeployments } = useLoaderData<typeof loader>()
  const [showCreate, setShowCreate] = useState(false)

  return (
    <VStack gap="space-32">
      <div>
        <HStack justify="space-between" align="center">
          <Heading level="1" size="xlarge" spacing>
            Seksjoner
          </Heading>
          {isAdmin && !showCreate && (
            <Button variant="tertiary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
              Ny seksjon
            </Button>
          )}
        </HStack>
        <BodyShort textColor="subtle">Samlet helsetilstand for SDLC governance</BodyShort>
      </div>

      {/* Summary cards */}
      <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
        <SummaryCard title="Deployments i år" value={ytdDeployments} icon={<BarChartIcon aria-hidden />} />
        <SummaryCard
          title="4-øyne dekning"
          value={formatCoverage(overallStats.fourEyesCoverage)}
          icon={<CheckmarkCircleIcon aria-hidden />}
          variant={getHealthVariant(overallStats.fourEyesCoverage)}
        />
        <SummaryCard
          title="Endringsopphav"
          value={formatCoverage(overallStats.goalCoverage)}
          icon={<LinkIcon aria-hidden />}
          variant={getHealthVariant(overallStats.goalCoverage)}
        />
        <SummaryCard
          title="Samlet helsetilstand"
          value={getHealthLabel(overallStats.fourEyesCoverage, overallStats.goalCoverage)}
          icon={getHealthIcon(overallStats.fourEyesCoverage, overallStats.goalCoverage)}
          variant={getHealthVariant(Math.min(overallStats.fourEyesCoverage, overallStats.goalCoverage))}
        />
      </HGrid>

      {showCreate && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post" onSubmit={() => setShowCreate(false)}>
            <input type="hidden" name="intent" value="create" />
            <VStack gap="space-16">
              <Heading level="2" size="small">
                Opprett ny seksjon
              </Heading>
              <HStack gap="space-16" wrap>
                <TextField label="Slug" name="slug" size="small" placeholder="f.eks. pensjon" autoComplete="off" />
                <TextField
                  label="Visningsnavn"
                  name="name"
                  size="small"
                  placeholder="f.eks. Pensjon og uføre"
                  autoComplete="off"
                />
              </HStack>
              <HStack gap="space-16" wrap>
                <TextField
                  label="Entra ID admin-gruppe"
                  name="entra_group_admin"
                  size="small"
                  placeholder="Gruppe-ID (valgfritt)"
                  autoComplete="off"
                />
                <TextField
                  label="Entra ID bruker-gruppe"
                  name="entra_group_user"
                  size="small"
                  placeholder="Gruppe-ID (valgfritt)"
                  autoComplete="off"
                />
              </HStack>
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Opprett
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setShowCreate(false)}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Box>
      )}

      {/* Section breakdown */}
      <VStack gap="space-16">
        <Heading level="2" size="large">
          Seksjoner
        </Heading>
        {sections.length === 0 ? (
          <Alert variant="info">Ingen seksjoner er opprettet ennå.</Alert>
        ) : (
          <VStack gap="space-12">
            {sections.map((section) => (
              <SectionCard key={section.id} section={section} />
            ))}
          </VStack>
        )}
      </VStack>
    </VStack>
  )
}

function SectionCard({
  section,
}: {
  section: SectionWithTeams & {
    stats: { total_deployments: number; four_eyes_coverage: number; goal_coverage: number }
  }
}) {
  const { stats } = section
  const fourEyesPct = formatCoverage(stats.four_eyes_coverage)
  const goalPct = formatCoverage(stats.goal_coverage)

  return (
    <Box padding="space-20" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <div className={styles.statGrid}>
        <Heading level="2" size="medium">
          <Link to={`/sections/${section.slug}`}>{section.name}</Link>
        </Heading>

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
          <Detail textColor="subtle">Helsetilstand</Detail>
          <Tag
            variant={getHealthVariant(Math.min(stats.four_eyes_coverage, stats.goal_coverage))}
            size="small"
            icon={getHealthIcon(stats.four_eyes_coverage, stats.goal_coverage)}
          >
            {getHealthLabel(stats.four_eyes_coverage, stats.goal_coverage)}
          </Tag>
        </VStack>
      </div>
    </Box>
  )
}

function SummaryCard({
  title,
  value,
  icon,
  variant = 'neutral',
}: {
  title: string
  value: string | number
  icon: ReactNode
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

function formatCoverage(ratio: number): string {
  const pct = Math.round(ratio * 100)
  if (ratio > 0 && pct === 0) return '<1%'
  if (ratio < 1 && pct === 100) return '99%'
  return `${pct}%`
}

function getHealthVariant(ratio: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (ratio >= 1) return 'success'
  if (ratio >= 0.9) return 'warning'
  if (ratio > 0) return 'error'
  return 'neutral'
}

function getHealthLabel(fourEyes: number, goalCoverage: number): string {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 1) return 'God'
  if (min >= 0.9) return 'Akseptabel'
  if (min > 0) return 'Trenger oppfølging'
  return 'Ingen data'
}

function getHealthIcon(fourEyes: number, goalCoverage: number): ReactNode {
  const min = Math.min(fourEyes, goalCoverage)
  if (min >= 0.9) return <CheckmarkCircleIcon aria-hidden />
  return <ExclamationmarkTriangleIcon aria-hidden />
}
