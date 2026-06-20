import { BarChartIcon, CheckmarkCircleIcon, ExclamationmarkTriangleIcon, LinkIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HGrid, HStack, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { type ActiveBoardData, ActiveBoardSection, type ActiveBoardSectionProps } from '~/components/ActiveBoardSection'
import { AppCard, type AppCardData } from '~/components/AppCard'

interface DevTeamInfo {
  id: number
  name: string
  slug: string
  section_slug: string
  nais_team_slugs: string[]
}

interface DevTeamSummaryStats {
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

interface MyTeamsPageProps {
  selectedDevTeams: DevTeamInfo[]
  teamStats: DevTeamSummaryStats | null
  issueApps: AppCardData[]
  boardSummaries: {
    board: ActiveBoardData
    objectives: ActiveBoardSectionProps['objectives']
    teamBasePath: string
    teamName: string
  }[]
  profileId?: string
  personalMissingGoalLinks?: number | null
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
  profileId: string | undefined
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

function MyTeamsPage({
  selectedDevTeams,
  teamStats,
  issueApps,
  boardSummaries,
  profileId,
  personalMissingGoalLinks = 0,
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
            <Button as={Link} to="/my-apps" size="small" variant="primary">
              Alle mine applikasjoner
            </Button>
            {selectedDevTeams.map((team) => (
              <Button
                key={team.id}
                as={Link}
                to={`/sections/${team.section_slug}/teams/${team.slug}`}
                size="small"
                variant="secondary"
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
                      <AppCard key={app.id} app={app} />
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

const mockTeams: DevTeamInfo[] = [
  {
    id: 1,
    name: 'Skjermbildemodernisering',
    slug: 'skjermbildemodernisering',
    section_slug: 'pensjon',
    nais_team_slugs: ['pensjon-skjerm'],
  },
  {
    id: 2,
    name: 'Starte pensjon',
    slug: 'starte-pensjon',
    section_slug: 'pensjon',
    nais_team_slugs: ['pensjon-start'],
  },
]

const mockBoards: MyTeamsPageProps['boardSummaries'] = [
  {
    board: {
      id: 1,
      period_label: 'T1 2026',
      period_type: 'tertiary',
      period_start: '2026-01-01',
      period_end: '2026-04-30',
    },
    teamBasePath: '/sections/pensjon/teams/skjermbildemodernisering',
    teamName: 'Skjermbildemodernisering',
    objectives: [
      {
        objective_id: 1,
        objective_title: 'Forbedre brukeropplevelse i saksbehandlerverktøy',
        keywords: ['ux-sak'],
        dependabot_target: false,
        total_linked_deployments: 12,
        key_results: [
          { id: 10, title: 'Redusere lastetid', linked_deployments: 8, keywords: [], dependabot_target: false },
          { id: 11, title: 'Ny navigasjon', linked_deployments: 4, keywords: ['nav-ui'], dependabot_target: false },
        ],
      },
      {
        objective_id: 2,
        objective_title: 'Modernisere komponentbibliotek',
        keywords: [],
        dependabot_target: false,
        total_linked_deployments: 7,
        key_results: [
          {
            id: 20,
            title: 'Migrere til Aksel v8',
            linked_deployments: 7,
            keywords: ['aksel'],
            dependabot_target: false,
          },
        ],
      },
    ],
  },
  {
    board: {
      id: 2,
      period_label: 'T1 2026',
      period_type: 'tertiary',
      period_start: '2026-01-01',
      period_end: '2026-04-30',
    },
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    teamName: 'Starte pensjon',
    objectives: [
      {
        objective_id: 10,
        objective_title: 'Lansere ny pensjonskalkulator',
        keywords: ['kalk-101'],
        dependabot_target: false,
        total_linked_deployments: 5,
        key_results: [{ id: 100, title: 'MVP ferdig', linked_deployments: 5, keywords: [], dependabot_target: false }],
      },
      {
        objective_id: 11,
        objective_title: 'Nødvendig forvaltning',
        keywords: [],
        dependabot_target: false,
        total_linked_deployments: 120,
        key_results: [
          {
            id: 110,
            title: 'Oppgradere avhengigheter',
            linked_deployments: 30,
            keywords: ['deps'],
            dependabot_target: false,
          },
          { id: 111, title: 'Dependabot-oppdatering', linked_deployments: 90, keywords: [], dependabot_target: true },
        ],
      },
    ],
  },
]

const mockTeamStatsHealthy: DevTeamSummaryStats = {
  total_apps: 8,
  total_deployments: 142,
  with_four_eyes: 142,
  without_four_eyes: 0,
  pending_verification: 0,
  linked_to_goal: 138,
  four_eyes_coverage: 1,
  goal_coverage: 0.97,
  four_eyes_percentage: 100,
  goal_percentage: 97,
  apps_with_issues: 0,
}

const mockTeamStatsLowCoverage: DevTeamSummaryStats = {
  total_apps: 8,
  total_deployments: 142,
  with_four_eyes: 110,
  without_four_eyes: 32,
  pending_verification: 0,
  linked_to_goal: 65,
  four_eyes_coverage: 0.77,
  goal_coverage: 0.46,
  four_eyes_percentage: 77,
  goal_percentage: 46,
  apps_with_issues: 3,
}

const mockIssueApps: AppCardData[] = [
  {
    id: 100,
    team_slug: 'pensjon-skjerm',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-skjermbilde',
    active_repo: 'navikt/pensjon-skjermbilde',
    stats: { total: 23, without_four_eyes: 4, pending_verification: 1 },
    alertCount: 2,
  },
  {
    id: 101,
    team_slug: 'pensjon-start',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-soknad',
    active_repo: 'navikt/pensjon-soknad',
    stats: { total: 12, without_four_eyes: 2, pending_verification: 0 },
    alertCount: 0,
  },
]

const meta: Meta<typeof MyTeamsPage> = {
  title: 'Pages/MyTeams',
  component: MyTeamsPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj<typeof MyTeamsPage>

export const MedTavler: Story = {
  name: 'Med aktive måltavler',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: mockBoards,
  },
}

export const MedTavlerOgIssues: Story = {
  name: 'Med tavler og applikasjoner som trenger oppfølging',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsLowCoverage,
    issueApps: mockIssueApps,
    boardSummaries: mockBoards,
  },
}

export const EnTavle: Story = {
  name: 'Kun én tavle (full bredde)',
  args: {
    selectedDevTeams: [mockTeams[0]],
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: [mockBoards[0]],
  },
}

export const UtenTavler: Story = {
  name: 'Uten aktive måltavler',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: [],
  },
}

export const IngenTeamValgt: Story = {
  name: 'Ingen team valgt (tomstate)',
  args: {
    selectedDevTeams: [],
    teamStats: null,
    issueApps: [],
    boardSummaries: [],
    profileId: 'ola.nordmann',
  },
}

export const AlleHarEndringsopphav: Story = {
  name: 'Endringsopphav: alle OK',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: mockBoards,
    personalMissingGoalLinks: 0,
  },
}

export const ManglerEndringsopphav: Story = {
  name: 'Endringsopphav: mangler kobling',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsLowCoverage,
    issueApps: mockIssueApps,
    boardSummaries: mockBoards,
    personalMissingGoalLinks: 47,
    profileId: 'pcmoen',
  },
}

export const IngenGitHubMapping: Story = {
  name: 'Endringsopphav: ingen GitHub-mapping',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: mockBoards,
    personalMissingGoalLinks: null,
    profileId: 'ola.nordmann',
  },
}

const mockIssueAppsWithGroup: AppCardData[] = [
  {
    id: 100,
    team_slug: 'pensjon-skjerm',
    environment_name: 'prod-fss',
    app_name: 'pensjon-psak',
    active_repo: 'navikt/pensjon-psak',
    stats: { total: 60, without_four_eyes: 3, pending_verification: 0, missing_goal_links: 5 },
    alertCount: 1,
    groupName: 'psak-og-penny',
    siblingEnvironments: ['prod-gcp'],
    groupApps: [
      { app_name: 'pensjon-psak', environment_name: 'prod-fss' },
      { app_name: 'pensjon-penny', environment_name: 'prod-gcp' },
    ],
  },
  {
    id: 101,
    team_slug: 'pensjon-start',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-soknad',
    active_repo: 'navikt/pensjon-soknad',
    stats: { total: 12, without_four_eyes: 2, pending_verification: 0 },
    alertCount: 0,
  },
]

export const MedGrupperteApps: Story = {
  name: 'Med grupperte applikasjoner',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsLowCoverage,
    issueApps: mockIssueAppsWithGroup,
    boardSummaries: mockBoards,
    personalMissingGoalLinks: 12,
    profileId: 'pcmoen',
  },
}

const mockIssueAppsWithBaseline: AppCardData[] = [
  {
    id: 200,
    team_slug: 'pensjonopptjening',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-opptjening-administrasjon',
    active_repo: 'navikt/pensjon-opptjening-administrasjon',
    stats: { total: 18, without_four_eyes: 0, pending_verification: 0, baseline_action_count: 1 },
    alertCount: 0,
  },
  {
    id: 201,
    team_slug: 'pensjon-start',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-soknad',
    active_repo: 'navikt/pensjon-soknad',
    stats: { total: 12, without_four_eyes: 1, pending_verification: 0, baseline_action_count: 1 },
    alertCount: 0,
  },
]

export const MedBaselineHandling: Story = {
  name: 'Baseline: apper som trenger baseline-handling',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsLowCoverage,
    issueApps: mockIssueAppsWithBaseline,
    boardSummaries: [],
    personalMissingGoalLinks: 0,
    profileId: 'pcmoen',
  },
}
