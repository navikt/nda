import { Alert, BodyShort, Box, Button, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Link } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { mockApps } from './mock-data'

interface DevTeamSummaryStats {
  total_apps: number
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  four_eyes_percentage: number
  apps_with_issues: number
}

interface DevTeamInfo {
  id: number
  name: string
  slug: string
  section_slug?: string
  nais_team_slugs: string[]
}

function TeamStatsCard({ stats }: { stats: DevTeamSummaryStats }) {
  const coverageVariant =
    stats.four_eyes_percentage >= 95 ? 'success' : stats.four_eyes_percentage >= 80 ? 'warning' : 'danger'

  return (
    <HGrid gap="space-16" columns={{ xs: 2, md: 4 }}>
      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Fireøyne-dekning
          </BodyShort>
          <HStack align="center" gap="space-8">
            <Heading size="large">{stats.four_eyes_percentage}%</Heading>
            <Tag data-color={coverageVariant} variant="moderate" size="xsmall">
              {coverageVariant === 'success' ? 'OK' : coverageVariant === 'warning' ? 'Bør forbedres' : 'Kritisk'}
            </Tag>
          </HStack>
        </VStack>
      </Box>
      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Totalt deployments
          </BodyShort>
          <Heading size="large">{stats.total_deployments}</Heading>
        </VStack>
      </Box>
      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Apper
          </BodyShort>
          <Heading size="large">{stats.total_apps}</Heading>
        </VStack>
      </Box>
      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Apper med problemer
          </BodyShort>
          <HStack align="center" gap="space-8">
            <Heading size="large">{stats.apps_with_issues}</Heading>
            {stats.apps_with_issues > 0 && (
              <Tag data-color="danger" variant="moderate" size="xsmall">
                Krever oppfølging
              </Tag>
            )}
          </HStack>
        </VStack>
      </Box>
    </HGrid>
  )
}

function HomePage({
  selectedDevTeams = [],
  teamStats = null,
  issueApps = [],
  isAdmin = false,
  githubUsername = 'pcmoen',
}: {
  selectedDevTeams?: DevTeamInfo[]
  teamStats?: DevTeamSummaryStats | null
  issueApps?: AppCardData[]
  isAdmin?: boolean
  githubUsername?: string | null
}) {
  return (
    <VStack gap="space-32">
      {isAdmin && (
        <HStack justify="end">
          <Button as={Link} to="/apps/add" size="small" variant="secondary">
            Legg til applikasjon
          </Button>
        </HStack>
      )}

      {selectedDevTeams.length === 0 && (
        <Alert variant="info">
          <VStack gap="space-8">
            <BodyShort>
              Du har ikke valgt noen utviklingsteam ennå. Gå til profilen din for å velge hvilke team du tilhører.
            </BodyShort>
            {githubUsername && (
              <div>
                <Button as={Link} to={`/users/${githubUsername}`} size="small" variant="secondary">
                  Min profil
                </Button>
              </div>
            )}
          </VStack>
        </Alert>
      )}

      {selectedDevTeams.length > 0 && teamStats && (
        <VStack gap="space-24">
          <HStack gap="space-8" align="center" wrap>
            {selectedDevTeams.map((team) => (
              <Tag key={team.id} variant="moderate" size="small">
                {team.name}
              </Tag>
            ))}
          </HStack>

          <TeamStatsCard stats={teamStats} />

          <HStack gap="space-8" wrap>
            {selectedDevTeams.map((team) => (
              <HStack key={team.id} gap="space-8">
                {team.nais_team_slugs.map((slug) => (
                  <Button key={slug} as={Link} to={`/team/${slug}`} size="small" variant="secondary">
                    Alle apper ({slug})
                  </Button>
                ))}
                <Button
                  as={Link}
                  to={`/sections/${team.section_slug}/teams/${team.slug}`}
                  size="small"
                  variant="secondary"
                >
                  {team.name} — Tavler
                </Button>
              </HStack>
            ))}
          </HStack>

          {issueApps.length > 0 ? (
            <VStack gap="space-16">
              <Heading level="3" size="small">
                Apper som trenger oppfølging ({issueApps.length})
              </Heading>
              <div>
                {issueApps.map((app) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </VStack>
          ) : (
            <Alert variant="success">Alle apper er i orden — ingen krever oppfølging.</Alert>
          )}
        </VStack>
      )}
    </VStack>
  )
}

const mockDevTeams: DevTeamInfo[] = [
  {
    id: 1,
    name: 'Motta pensjon',
    slug: 'motta-pensjon',
    section_slug: 'pensjon',
    nais_team_slugs: ['pensjondeployer', 'pensjonsamhandling'],
  },
]

const mockAvailableTeams: DevTeamInfo[] = [
  ...mockDevTeams,
  {
    id: 2,
    name: 'Beregne pensjon',
    slug: 'beregne-pensjon',
    section_slug: 'pensjon',
    nais_team_slugs: ['pensjonberegning'],
  },
  {
    id: 3,
    name: 'Utbetale pensjon',
    slug: 'utbetale-pensjon',
    section_slug: 'pensjon',
    nais_team_slugs: ['pensjonutbetaling'],
  },
]

const mockTeamStats: DevTeamSummaryStats = {
  total_apps: 5,
  total_deployments: 42,
  with_four_eyes: 38,
  without_four_eyes: 2,
  pending_verification: 2,
  four_eyes_percentage: 90,
  apps_with_issues: 2,
}

const mockIssueApps = mockApps.filter((app) => app.stats.without_four_eyes > 0 || app.stats.pending_verification > 0)

const meta: Meta<typeof HomePage> = {
  title: 'Pages/Home',
  component: HomePage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof HomePage>

export const WithTeamsSelected: Story = {
  name: 'Med valgte team',
  args: {
    selectedDevTeams: mockDevTeams,
    teamStats: mockTeamStats,
    issueApps: mockIssueApps,
  },
}

export const MultipleTeams: Story = {
  name: 'Flere team valgt',
  args: {
    selectedDevTeams: mockAvailableTeams.slice(0, 2),
    teamStats: { ...mockTeamStats, total_apps: 12, total_deployments: 98 },
    issueApps: mockIssueApps,
  },
}

export const NoTeamSelected: Story = {
  name: 'Ingen team valgt',
  args: {
    selectedDevTeams: [],
    teamStats: null,
    issueApps: [],
  },
}

export const AllAppsOk: Story = {
  name: 'Alle apper i orden',
  args: {
    selectedDevTeams: mockDevTeams,
    teamStats: { ...mockTeamStats, apps_with_issues: 0, without_four_eyes: 0 },
    issueApps: [],
  },
}

export const HighCoverage: Story = {
  name: 'Høy dekning (95%+)',
  args: {
    selectedDevTeams: mockDevTeams,
    teamStats: { ...mockTeamStats, four_eyes_percentage: 98, apps_with_issues: 0 },
    issueApps: [],
  },
}

export const LowCoverage: Story = {
  name: 'Lav dekning (<80%)',
  args: {
    selectedDevTeams: mockDevTeams,
    teamStats: { ...mockTeamStats, four_eyes_percentage: 65, apps_with_issues: 3 },
    issueApps: mockApps.slice(0, 3),
  },
}

export const AdminView: Story = {
  name: 'Som admin',
  args: {
    selectedDevTeams: mockDevTeams,
    teamStats: mockTeamStats,
    issueApps: mockIssueApps,
    isAdmin: true,
  },
}
