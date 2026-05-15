import { Alert, BodyShort, Box, Button, Heading, HGrid, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'

export interface HomeDevTeamInfo {
  id: number
  name: string
  slug: string
  section_slug?: string
  nais_team_slugs: string[]
}

export interface HomeDevTeamSummaryStats {
  total_apps: number
  total_deployments: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  four_eyes_percentage: number
  apps_with_issues: number
}

interface HomePageProps {
  selectedDevTeams?: HomeDevTeamInfo[]
  teamStats?: HomeDevTeamSummaryStats | null
  issueApps?: AppCardData[]
  githubUsername?: string | null
}

function TeamStatsCard({ stats }: { stats: HomeDevTeamSummaryStats }) {
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
            Applikasjoner
          </BodyShort>
          <Heading size="large">{stats.total_apps}</Heading>
        </VStack>
      </Box>
      <Box padding="space-16" background="raised" borderRadius="4">
        <VStack gap="space-4">
          <BodyShort size="small" textColor="subtle">
            Applikasjoner med problemer
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

export function HomePage({
  selectedDevTeams = [],
  teamStats = null,
  issueApps = [],
  githubUsername = null,
}: HomePageProps) {
  return (
    <VStack gap="space-32">
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
                    Alle applikasjoner ({slug})
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
                Applikasjoner som trenger oppfølging ({issueApps.length})
              </Heading>
              <div>
                {issueApps.map((app) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </VStack>
          ) : (
            <Alert variant="success">Alle applikasjoner er i orden — ingen krever oppfølging.</Alert>
          )}
        </VStack>
      )}
    </VStack>
  )
}
