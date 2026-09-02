import { BodyShort, Box, Heading, Table, VStack } from '@navikt/ds-react'
import { useLoaderData } from 'react-router'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/debug-group-comparison'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Debug: gruppe- vs repo-basert gruppering - Admin' }]
}

interface Mismatch {
  app_id: number
  app_name: string
  team_slug: string
  environment_name: string
  group_based_siblings: number[]
  repo_based_siblings: number[]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const [allApps, activeRepos] = await Promise.all([getAllMonitoredApplications(), getAllActiveRepositories()])
  const activeApps = allApps.filter((a) => a.is_active)

  const idsByGroupId = new Map<number, number[]>()
  for (const app of activeApps) {
    if (app.application_group_id == null) continue
    const ids = idsByGroupId.get(app.application_group_id) ?? []
    ids.push(app.id)
    idsByGroupId.set(app.application_group_id, ids)
  }

  const idsByRepoKey = new Map<string, number[]>()
  for (const app of activeApps) {
    const repoKey = activeRepos.get(app.id)
    if (!repoKey) continue
    const ids = idsByRepoKey.get(repoKey) ?? []
    ids.push(app.id)
    idsByRepoKey.set(repoKey, ids)
  }

  const mismatches: Mismatch[] = []
  for (const app of activeApps) {
    const groupSiblings = (
      app.application_group_id != null ? (idsByGroupId.get(app.application_group_id) ?? [app.id]) : [app.id]
    )
      .filter((id) => id !== app.id)
      .sort((a, b) => a - b)

    const repoKey = activeRepos.get(app.id)
    const repoSiblings = (repoKey ? (idsByRepoKey.get(repoKey) ?? [app.id]) : [app.id])
      .filter((id) => id !== app.id)
      .sort((a, b) => a - b)

    if (groupSiblings.join(',') !== repoSiblings.join(',')) {
      mismatches.push({
        app_id: app.id,
        app_name: app.app_name,
        team_slug: app.team_slug,
        environment_name: app.environment_name,
        group_based_siblings: groupSiblings,
        repo_based_siblings: repoSiblings,
      })
    }
  }

  return { mismatches, totalAppsChecked: activeApps.length }
}

export default function DebugGroupComparisonPage() {
  const { mismatches, totalAppsChecked } = useLoaderData<typeof loader>()

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-24">
        <div>
          <Heading level="1" size="large" spacing>
            Debug: gruppe- vs repo-basert gruppering
          </Heading>
          <BodyShort textColor="subtle">
            Midlertidig side som sammenligner gruppering via application_groups mot gruppering basert på delt aktivt
            git-repo, for alle aktive applikasjoner. Fjernes etter bruk. Sjekket {totalAppsChecked} applikasjoner, fant{' '}
            {mismatches.length} avvik.
          </BodyShort>
        </div>

        {mismatches.length === 0 ? (
          <BodyShort>Ingen avvik funnet — gruppe-basert og repo-basert gruppering gir samme resultat.</BodyShort>
        ) : (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>app_id</Table.HeaderCell>
                <Table.HeaderCell>app_name</Table.HeaderCell>
                <Table.HeaderCell>team_slug</Table.HeaderCell>
                <Table.HeaderCell>environment</Table.HeaderCell>
                <Table.HeaderCell>gruppe-baserte søsken</Table.HeaderCell>
                <Table.HeaderCell>repo-baserte søsken</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {mismatches.map((m) => (
                <Table.Row key={m.app_id}>
                  <Table.DataCell>{m.app_id}</Table.DataCell>
                  <Table.DataCell>{m.app_name}</Table.DataCell>
                  <Table.DataCell>{m.team_slug}</Table.DataCell>
                  <Table.DataCell>{m.environment_name}</Table.DataCell>
                  <Table.DataCell>{m.group_based_siblings.join(', ') || '-'}</Table.DataCell>
                  <Table.DataCell>{m.repo_based_siblings.join(', ') || '-'}</Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </VStack>
    </Box>
  )
}
