import { Alert, BodyShort, Box, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getGroupNamesByIds } from '~/db/application-groups.server'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import { getDevTeamApplications, getGroupAppIdsForDevTeams } from '~/db/dev-teams.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getUserDevTeamsByRole } from '~/db/role-assignments.server'
import { requireUser } from '~/lib/auth.server'
import { groupAppCards } from '~/lib/group-app-cards'
import type { Route } from './+types/my-apps'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Mine applikasjoner - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const identity = await requireUser(request)

  let selectedDevTeams: Awaited<ReturnType<typeof getUserDevTeamsByRole>> = []
  try {
    selectedDevTeams = await getUserDevTeamsByRole(identity.navIdent)
  } catch {
    // Graceful degradation if role assignments query fails
  }

  if (selectedDevTeams.length === 0) {
    return { appsByTeamAndEnv: {}, teamNames: [] }
  }

  const allNaisTeamSlugs = [...new Set(selectedDevTeams.flatMap((t) => t.nais_team_slugs))]
  const devTeamIds = selectedDevTeams.map((t) => t.id)
  const [directAppsResults, groupAppIds] = await Promise.all([
    Promise.all(selectedDevTeams.map((t) => getDevTeamApplications(t.id))),
    getGroupAppIdsForDevTeams(devTeamIds),
  ])
  const allDirectAppIds = [...new Set([...directAppsResults.flat().map((a) => a.monitored_app_id), ...groupAppIds])]

  const allApps = await getAllMonitoredApplications()
  const [alertCounts, activeReposByApp] = await Promise.all([getAllAlertCounts(), getAllActiveRepositories()])

  const directAppIdSet = new Set(allDirectAppIds)
  const naisTeamSlugSet = new Set(allNaisTeamSlugs)

  const userApps = allApps.filter((app) => directAppIdSet.has(app.id) || naisTeamSlugSet.has(app.team_slug))

  const statsByApp =
    userApps.length > 0
      ? await getAppDeploymentStatsBatch(userApps.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year })))
      : new Map()

  const groupIds = [...new Set(userApps.map((a) => a.application_group_id).filter((id): id is number => id != null))]
  const groupNames = await getGroupNamesByIds(groupIds)

  const appCards = groupAppCards(
    userApps.map((app) => ({
      ...app,
      active_repo: activeReposByApp.get(app.id) || null,
      stats: statsByApp.get(app.id) || {
        total: 0,
        with_four_eyes: 0,
        without_four_eyes: 0,
        pending_verification: 0,
        last_deployment: null,
        last_deployment_id: null,
        four_eyes_percentage: 0,
      },
      alertCount: alertCounts.get(app.id) || 0,
    })),
    groupNames,
  )

  const appsByTeamAndEnv: Record<string, Record<string, AppCardData[]>> = {}
  for (const app of appCards) {
    if (!appsByTeamAndEnv[app.team_slug]) {
      appsByTeamAndEnv[app.team_slug] = {}
    }
    if (!appsByTeamAndEnv[app.team_slug][app.environment_name]) {
      appsByTeamAndEnv[app.team_slug][app.environment_name] = []
    }
    appsByTeamAndEnv[app.team_slug][app.environment_name].push(app)
  }

  const teamNames = selectedDevTeams.map((t) => t.name)

  return { appsByTeamAndEnv, teamNames }
}

export default function MyAppsPage({ loaderData: { appsByTeamAndEnv, teamNames } }: Route.ComponentProps) {
  const teamSlugs = Object.keys(appsByTeamAndEnv).sort()
  const totalApps = teamSlugs.reduce(
    (sum, team) => sum + Object.values(appsByTeamAndEnv[team]).reduce((envSum, apps) => envSum + apps.length, 0),
    0,
  )

  if (teamSlugs.length === 0) {
    return (
      <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
        <VStack gap="space-24">
          <Heading level="1" size="xlarge">
            Mine applikasjoner
          </Heading>
          <Alert variant="info">
            <BodyShort>
              Du er ikke tilknyttet noen team ennå. Be en teamadministrator om å tildele deg en rolle.
            </BodyShort>
          </Alert>
        </VStack>
      </Box>
    )
  }

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading level="1" size="xlarge">
            Mine applikasjoner
          </Heading>
          <HStack gap="space-8" align="center">
            <Tag size="small" variant="neutral">
              {totalApps} {totalApps === 1 ? 'applikasjon' : 'applikasjoner'}
            </Tag>
            <BodyShort size="small" textColor="subtle">
              fra {teamNames.join(', ')}
            </BodyShort>
          </HStack>
        </VStack>

        <VStack gap="space-32">
          {teamSlugs.map((teamSlug) => {
            const environments = Object.keys(appsByTeamAndEnv[teamSlug]).sort()
            return (
              <VStack key={teamSlug} gap="space-16">
                <HStack gap="space-8" align="center">
                  <Link to={`/team/${teamSlug}`} className="no-underline hover:underline">
                    <Heading level="2" size="medium">
                      {teamSlug}
                    </Heading>
                  </Link>
                </HStack>

                <VStack gap="space-16">
                  {environments.map((env) => (
                    <VStack key={env} gap="space-8">
                      <HStack gap="space-8" align="center">
                        <Link to={`/team/${teamSlug}/env/${env}`} className="no-underline hover:underline">
                          <Heading level="3" size="small">
                            {env}
                          </Heading>
                        </Link>
                        <Tag size="xsmall" variant="neutral">
                          {appsByTeamAndEnv[teamSlug][env].length}
                        </Tag>
                      </HStack>

                      <div>
                        {appsByTeamAndEnv[teamSlug][env].map((app) => (
                          <AppCard key={app.id} app={app} showEnvironment={false} />
                        ))}
                      </div>
                    </VStack>
                  ))}
                </VStack>
              </VStack>
            )
          })}
        </VStack>
      </VStack>
    </Box>
  )
}
