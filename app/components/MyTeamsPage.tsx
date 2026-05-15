import { BarChartIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, LinkIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, VStack } from '@navikt/ds-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { type ActiveBoardData, ActiveBoardSection, type ActiveBoardSectionProps } from '~/components/ActiveBoardSection'
import { AppCard, type AppCardData } from '~/components/AppCard'

export interface DevTeamInfo {
  id: number
  name: string
  slug: string
  section_slug: string | null
  nais_team_slugs: string[]
}

export interface DevTeamSummaryStats {
  total_apps: number
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  linked_to_goal: number
  four_eyes_coverage: number
  goal_coverage: number
  four_eyes_percentage: number
  goal_percentage: number
  apps_with_issues: number
}

export interface MyTeamsBoardSummary {
  board: ActiveBoardData
  objectives: ActiveBoardSectionProps['objectives']
  teamBasePath: string
  teamName: string
}

export interface MyTeamsPageProps {
  selectedDevTeams: DevTeamInfo[]
  teamStats: DevTeamSummaryStats | null
  issueApps: AppCardData[]
  boardSummaries: MyTeamsBoardSummary[]
  profileId?: string | null
  personalMissingGoalLinks?: number | null
  noTeamMembersMapped?: boolean
  unmappedContributors?: string[]
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

function PersonalGoalStatus({
  personalMissingGoalLinks,
  profileId,
}: {
  personalMissingGoalLinks: number | null
  profileId: string | null | undefined
}) {
  if (personalMissingGoalLinks === null) {
    return (
      <Alert variant="info">
        <VStack gap="space-8">
          <BodyShort>
            For å se dine egne deployments som mangler kobling til mål, må du legge til GitHub-brukernavnet ditt i
            NDA-profilen.
          </BodyShort>
          {profileId && (
            <div>
              <Button as={Link} to={`/users/${profileId}`} size="small" variant="secondary">
                Åpne min profil
              </Button>
            </div>
          )}
        </VStack>
      </Alert>
    )
  }

  if (personalMissingGoalLinks > 0) {
    return (
      <Alert variant="warning">
        <VStack gap="space-8">
          <BodyShort>
            <strong>{personalMissingGoalLinks} av dine deployments mangler endringsopphav.</strong> Koble dem til mål
            eller nøkkelresultater i NDA.
          </BodyShort>
          {profileId && (
            <div>
              <Button as={Link} to={`/users/${profileId}?goal=without_goal`} size="small" variant="secondary">
                Koble mine deployments
              </Button>
            </div>
          )}
        </VStack>
      </Alert>
    )
  }

  return (
    <HStack gap="space-8" align="center">
      <CheckmarkCircleIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
      <BodyShort size="small" textColor="subtle">
        Alle dine deployments har endringsopphav
      </BodyShort>
    </HStack>
  )
}

export function MyTeamsPage({
  selectedDevTeams,
  teamStats,
  issueApps,
  boardSummaries,
  profileId,
  personalMissingGoalLinks = 0,
  noTeamMembersMapped = false,
  unmappedContributors = [],
}: MyTeamsPageProps) {
  return (
    <VStack gap="space-32">
      <div>
        <Heading level="1" size="xlarge" spacing>
          Mine team
        </Heading>
        <BodyShort textColor="subtle">Helsetilstand for dine utviklingsteam</BodyShort>
      </div>

      {selectedDevTeams.length === 0 && (
        <Alert variant="info">
          <VStack gap="space-8">
            <BodyShort>
              Du har ikke valgt noen utviklingsteam ennå. Gå til profilen din for å velge hvilke team du tilhører.
            </BodyShort>
            {profileId && (
              <div>
                <Button as={Link} to={`/users/${profileId}`} size="small" variant="secondary">
                  Min profil
                </Button>
              </div>
            )}
          </VStack>
        </Alert>
      )}

      {selectedDevTeams.length > 0 && teamStats && (
        <VStack gap="space-24">
          {noTeamMembersMapped && (
            <Alert variant="info">
              Ingen av medlemmene i dine team er koblet til en GitHub-bruker, så tallene under er 0. Be teammedlemmene
              registrere GitHub-brukernavn under <Link to="/admin/users">Brukermapping</Link> så blir tallene riktige.
            </Alert>
          )}
          {unmappedContributors.length > 0 && (
            <Alert variant="warning">
              <VStack gap="space-8">
                <BodyShort>
                  {unmappedContributors.length === 1
                    ? '1 deployer i år mangler brukermapping.'
                    : `${unmappedContributors.length} deployere i år mangler brukermapping.`}{' '}
                  Deres deployments telles ikke med i de personfiltrerte tallene under.
                </BodyShort>
                <BodyShort size="small" textColor="subtle">
                  Umappede brukernavn: {unmappedContributors.slice(0, 10).join(', ')}
                  {unmappedContributors.length > 10 && ` og ${unmappedContributors.length - 10} til`}
                </BodyShort>
                <div>
                  <Button as={Link} to="/admin/users" size="small" variant="secondary">
                    Gå til brukermapping
                  </Button>
                </div>
              </VStack>
            </Alert>
          )}
          <HGrid gap="space-16" columns={{ xs: 1, sm: 2, lg: 4 }}>
            <SummaryCard
              title="Deployments i år"
              value={teamStats.total_deployments}
              icon={<BarChartIcon aria-hidden />}
            />
            <SummaryCard
              title="4-øyne dekning"
              value={formatCoverage(teamStats.four_eyes_coverage)}
              icon={<CheckmarkCircleIcon aria-hidden />}
              variant={getHealthVariant(teamStats.four_eyes_coverage)}
            />
            <SummaryCard
              title="Endringsopphav"
              value={formatCoverage(teamStats.goal_coverage)}
              icon={<LinkIcon aria-hidden />}
              variant={getHealthVariant(teamStats.goal_coverage)}
            />
            <SummaryCard
              title="Samlet helsetilstand"
              value={getHealthLabel(teamStats.four_eyes_coverage, teamStats.goal_coverage)}
              icon={getHealthIcon(teamStats.four_eyes_coverage, teamStats.goal_coverage)}
              variant={getHealthVariant(Math.min(teamStats.four_eyes_coverage, teamStats.goal_coverage))}
            />
          </HGrid>

          <HStack gap="space-8" wrap>
            <Button as={Link} to="/my-apps" size="small" variant="tertiary">
              Alle mine applikasjoner
            </Button>
            {selectedDevTeams.map((team) => (
              <Button
                key={team.id}
                as={Link}
                to={`/sections/${team.section_slug}/teams/${team.slug}`}
                size="small"
                variant="tertiary"
              >
                {team.name}
              </Button>
            ))}
          </HStack>

          {boardSummaries.length > 0 && (
            <VStack gap="space-16">
              <Heading level="3" size="small">
                Aktive måltavler
              </Heading>
              <VStack gap="space-16">
                {boardSummaries.map((bs) => (
                  <ActiveBoardSection
                    key={bs.board.id}
                    board={bs.board}
                    objectives={bs.objectives}
                    teamBasePath={bs.teamBasePath}
                    teamName={bs.teamName}
                    headingLevel="4"
                  />
                ))}
              </VStack>
            </VStack>
          )}

          {personalMissingGoalLinks === 0 && issueApps.length === 0 ? (
            <HStack gap="space-8" align="center">
              <CheckmarkCircleIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
              <BodyShort size="small" textColor="subtle">
                Alle dine deployments har endringsopphav og alle applikasjoner er i orden
              </BodyShort>
            </HStack>
          ) : (
            <>
              <PersonalGoalStatus personalMissingGoalLinks={personalMissingGoalLinks} profileId={profileId} />
              {issueApps.length > 0 && (
                <VStack gap="space-16">
                  <Heading level="3" size="small">
                    Applikasjoner som trenger oppfølging ({issueApps.length})
                  </Heading>
                  <div>
                    {issueApps.map((app) => (
                      <AppCard key={app.id} app={app} appendSearchParams="team=mine" />
                    ))}
                  </div>
                </VStack>
              )}
            </>
          )}
        </VStack>
      )}
    </VStack>
  )
}
