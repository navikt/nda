import { PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Select, Tag, TextField, VStack } from '@navikt/ds-react'
import { Form, Link, useActionData, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import {
  addAppToGroup,
  createApplicationGroup,
  deleteGroup,
  getAllGroups,
  getGroupWithApps,
  removeAppFromGroup,
} from '~/db/application-groups.server'
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/application-groups'

export function meta() {
  return [{ title: 'Applikasjonsgrupper - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const [groups, allApps] = await Promise.all([getAllGroups(), getAllMonitoredApplications()])

  // Fetch details for each group
  const groupDetails = await Promise.all(groups.map((g) => getGroupWithApps(g.id)))

  // Find apps that could be grouped (same app_name, different environment/team, not in a group)
  const ungroupedApps = allApps.filter((app) => app.is_active && !app.application_group_id)

  // Suggest groups: apps with same app_name deployed to multiple environments
  const appNameCounts = new Map<string, number>()
  for (const app of ungroupedApps) {
    appNameCounts.set(app.app_name, (appNameCounts.get(app.app_name) ?? 0) + 1)
  }
  const suggestions = [...appNameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort()

  return { groups: groupDetails.filter(Boolean), ungroupedApps, suggestions }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create_group') {
    const name = (formData.get('name') as string)?.trim()
    if (!name) return { error: 'Gruppenavn er påkrevd' }

    await createApplicationGroup(name)
    return { success: `Opprettet gruppe "${name}"` }
  }

  if (intent === 'delete_group') {
    const groupId = parseInt(formData.get('group_id') as string, 10)
    if (!groupId) return { error: 'Ugyldig gruppe-ID' }

    await deleteGroup(groupId)
    return { success: 'Gruppe slettet' }
  }

  if (intent === 'add_app') {
    const groupId = parseInt(formData.get('group_id') as string, 10)
    const appId = parseInt(formData.get('app_id') as string, 10)
    if (!groupId || !appId) return { error: 'Ugyldig gruppe- eller applikasjons-ID' }

    await addAppToGroup(groupId, appId)
    return { success: 'Applikasjon lagt til i gruppen' }
  }

  if (intent === 'remove_app') {
    const appId = parseInt(formData.get('app_id') as string, 10)
    if (!appId) return { error: 'Ugyldig applikasjons-ID' }

    await removeAppFromGroup(appId)
    return { success: 'Applikasjon fjernet fra gruppen' }
  }

  if (intent === 'create_from_suggestion') {
    const appName = formData.get('app_name') as string
    if (!appName) return { error: 'Mangler applikasjonsnavn' }

    const allApps = await getAllMonitoredApplications()
    const appsToGroup = allApps.filter((app) => app.is_active && app.app_name === appName && !app.application_group_id)

    if (appsToGroup.length < 2) return { error: 'Fant ikke nok applikasjoner å gruppere' }

    const group = await createApplicationGroup(appName)
    await Promise.all(appsToGroup.map((app) => addAppToGroup(group.id, app.id)))
    return { success: `Opprettet gruppe "${appName}" med ${appsToGroup.length} applikasjoner` }
  }

  return { error: 'Ukjent handling' }
}

export default function ApplicationGroupsAdmin() {
  const { groups, ungroupedApps, suggestions } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <VStack gap="space-24">
      <HStack align="center" justify="space-between">
        <div>
          <Heading size="large" level="1">
            Applikasjonsgrupper
          </Heading>
          <BodyShort textColor="subtle">
            Grupper applikasjoner som er samme logiske app på tvers av NAIS-clustre. Verifikasjonsstatus propageres
            automatisk innad i gruppen.
          </BodyShort>
        </div>
        <Link to="/admin" style={{ textDecoration: 'none' }}>
          <Button variant="tertiary" size="small">
            ← Tilbake
          </Button>
        </Link>
      </HStack>

      <ActionAlert data={actionData} />

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16">
            <Heading size="small" level="2">
              Foreslåtte grupper
            </Heading>
            <BodyShort textColor="subtle">
              Disse applikasjonene finnes i flere miljøer/team uten å være gruppert:
            </BodyShort>
            <VStack gap="space-8">
              {suggestions.map((appName) => (
                <HStack key={appName} gap="space-12" align="center" justify="space-between">
                  <HStack gap="space-8" align="center">
                    <BodyShort weight="semibold">{appName}</BodyShort>
                    <Tag size="xsmall" variant="info">
                      {ungroupedApps.filter((a) => a.app_name === appName).length} miljøer
                    </Tag>
                  </HStack>
                  <Form method="post">
                    <input type="hidden" name="intent" value="create_from_suggestion" />
                    <input type="hidden" name="app_name" value={appName} />
                    <Button variant="tertiary" size="xsmall" type="submit" icon={<PlusIcon aria-hidden />}>
                      Opprett gruppe
                    </Button>
                  </Form>
                </HStack>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}

      {/* Create new group */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Opprett ny gruppe
          </Heading>
          <Form method="post">
            <input type="hidden" name="intent" value="create_group" />
            <HStack gap="space-12" align="end">
              <TextField label="Gruppenavn" name="name" size="small" style={{ flex: 1 }} />
              <Button variant="secondary" size="small" type="submit" icon={<PlusIcon aria-hidden />}>
                Opprett
              </Button>
            </HStack>
          </Form>
        </VStack>
      </Box>

      {/* Existing groups */}
      {groups.length === 0 ? (
        <Alert variant="info">Ingen applikasjonsgrupper opprettet enda.</Alert>
      ) : (
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Eksisterende grupper ({groups.length})
          </Heading>
          {groups.map(
            (group) =>
              group && (
                <Box
                  key={group.id}
                  padding="space-24"
                  borderRadius="8"
                  background="raised"
                  borderColor="neutral-subtle"
                  borderWidth="1"
                >
                  <VStack gap="space-16">
                    <HStack align="center" justify="space-between">
                      <HStack gap="space-12" align="center">
                        <Heading size="xsmall" level="3">
                          {group.name}
                        </Heading>
                        <Tag size="xsmall" variant="neutral">
                          {group.apps.length} applikasjon{group.apps.length !== 1 ? 'er' : ''}
                        </Tag>
                      </HStack>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete_group" />
                        <input type="hidden" name="group_id" value={group.id} />
                        <Button variant="tertiary-neutral" size="xsmall" type="submit" icon={<TrashIcon aria-hidden />}>
                          Slett
                        </Button>
                      </Form>
                    </HStack>

                    {/* Apps in group */}
                    {group.apps.length > 0 && (
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
                            <Form method="post">
                              <input type="hidden" name="intent" value="remove_app" />
                              <input type="hidden" name="app_id" value={app.id} />
                              <Button
                                variant="tertiary-neutral"
                                size="xsmall"
                                type="submit"
                                icon={<TrashIcon aria-hidden />}
                              >
                                Fjern
                              </Button>
                            </Form>
                          </HStack>
                        ))}
                      </VStack>
                    )}

                    {/* Add app to group */}
                    <Form method="post">
                      <input type="hidden" name="intent" value="add_app" />
                      <input type="hidden" name="group_id" value={group.id} />
                      <HStack gap="space-12" align="end">
                        <Select label="Legg til applikasjon" name="app_id" size="small" style={{ flex: 1 }}>
                          <option value="">Velg applikasjon...</option>
                          {ungroupedApps.map((app) => (
                            <option key={app.id} value={app.id}>
                              {app.app_name} ({app.team_slug} / {app.environment_name})
                            </option>
                          ))}
                        </Select>
                        <Button variant="tertiary" size="small" type="submit" icon={<PlusIcon aria-hidden />}>
                          Legg til
                        </Button>
                      </HStack>
                    </Form>
                  </VStack>
                </Box>
              ),
          )}
        </VStack>
      )}
    </VStack>
  )
}
