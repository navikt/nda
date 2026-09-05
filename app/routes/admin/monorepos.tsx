import { LayersIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Link, useLoaderData } from 'react-router'
import { getAllMonorepoGroups } from '~/db/monorepo.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/monorepos'

export function meta() {
  return [{ title: 'Monorepoer - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const groups = await getAllMonorepoGroups()

  return { groups }
}

export default function MonoreposAdmin() {
  const { groups } = useLoaderData<typeof loader>()

  return (
    <VStack gap="space-24">
      <HStack align="center" justify="space-between">
        <div>
          <Heading size="large" level="1">
            Monorepoer
          </Heading>
          <BodyShort textColor="subtle">
            Repoer som automatisk er oppdaget som monorepo fordi to eller flere aktive applikasjoner deler samme aktive
            git-repo. Dette er uavhengig av applikasjonsgrupper, og brukes til å forstå hvilke apper som
            produksjonssettes fra samme kodebase.
          </BodyShort>
        </div>
        <Button as={Link} to="/admin" variant="tertiary" size="small">
          ← Tilbake
        </Button>
      </HStack>

      {groups.length === 0 ? (
        <Alert variant="info">Ingen monorepoer er oppdaget enda.</Alert>
      ) : (
        <VStack gap="space-16">
          {groups.map((group) => (
            <Box
              key={`${group.github_owner}/${group.github_repo_name}`}
              padding="space-24"
              borderRadius="8"
              background="raised"
              borderColor="neutral-subtle"
              borderWidth="1"
            >
              <VStack gap="space-16">
                <HStack gap="space-12" align="center">
                  <LayersIcon fontSize="1.5rem" aria-hidden />
                  <Heading size="xsmall" level="2">
                    {group.github_owner}/{group.github_repo_name}
                  </Heading>
                  <Tag size="xsmall" variant="neutral">
                    {group.apps.length} applikasjoner
                  </Tag>
                  <Tag size="xsmall" variant={group.repository_linked ? 'success' : 'warning'}>
                    {group.repository_linked ? 'repo-innstillinger' : 'per-app-innstillinger'}
                  </Tag>
                </HStack>

                {(group.base_branch_mismatch || group.audit_year_mismatch) && (
                  <Alert variant="warning" size="small">
                    {group.base_branch_mismatch && group.audit_year_mismatch
                      ? 'Applikasjonene har ulik effektiv base branch og ulikt effektivt revisjons-startår.'
                      : group.base_branch_mismatch
                        ? 'Applikasjonene har ulik effektiv base branch.'
                        : 'Applikasjonene har ulikt effektivt revisjons-startår.'}{' '}
                    {group.repository_linked
                      ? 'Repoet er koblet, så dette skyldes at repo-innstillingen mangler og appene faller tilbake til sine egne verdier.'
                      : 'Repoet mangler foreløpig en repo-innstillingsrad (github_repo_id er kanskje ikke satt ennå, eller raden er ikke opprettet enda), så innstillingene styres fortsatt per app.'}
                  </Alert>
                )}

                <VStack gap="space-4">
                  {group.apps.map((app) => (
                    <HStack key={app.id} gap="space-8" align="center" justify="space-between">
                      <HStack gap="space-8" align="center">
                        <BodyShort size="small">{app.app_name}</BodyShort>
                        <Tag size="xsmall" variant="neutral">
                          {app.team_slug}
                        </Tag>
                        <Tag size="xsmall" variant="info">
                          {app.environment_name}
                        </Tag>
                      </HStack>
                      <HStack gap="space-8" align="center">
                        <Tag size="xsmall" variant="neutral">
                          {app.default_branch ?? 'ukjent branch'}
                        </Tag>
                        <Tag size="xsmall" variant="neutral">
                          {app.audit_start_year ?? 'ukjent startår'}
                        </Tag>
                      </HStack>
                    </HStack>
                  ))}
                </VStack>
              </VStack>
            </Box>
          ))}
        </VStack>
      )}
    </VStack>
  )
}
