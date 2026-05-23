import { ArrowUndoIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Detail, Heading, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { Form, useActionData, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { ExternalLink } from '~/components/ExternalLink'
import { UserName } from '~/components/UserName'
import {
  getAllSoftDeleted,
  restoreDeploymentComment,
  restoreDevTeamApplication,
  restoreDevTeamNaisTeam,
  restoreExternalReference,
  restoreSectionTeam,
  restoreUserMapping,
} from '~/db/soft-deleted.server'
import { getUserMappings, type UserMapping } from '~/db/user-mappings.server'
import { type ActionResult, fail, ok } from '~/lib/action-result'
import { requireAdmin } from '~/lib/auth.server'
import { isSafeHttpUrl, parseId } from '~/lib/route-helpers'
import { serializeUserMappings, type UserMappings } from '~/lib/user-display'
import type { Route } from './+types/soft-deleted'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Slettede rader - Admin - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const summary = await getAllSoftDeleted()

  // Resolve display names for all "deleted_by" navIdents in one batch.
  const navIdents = new Set<string>()
  for (const list of [
    summary.userMappings,
    summary.deploymentComments,
    summary.devTeamApplications,
    summary.sectionTeams,
    summary.devTeamNaisTeams,
    summary.externalReferences,
  ]) {
    for (const row of list) {
      if (row.deleted_by) navIdents.add(row.deleted_by)
    }
  }
  const mappingsByIdent = await getUserMappings(Array.from(navIdents))

  // Build a map keyed by github_username for <UserName>/getUserDisplayName,
  // and a navIdent → github_username lookup for resolving "deleted_by" ids.
  // Re-keying is required: getUserMappings returns a Map keyed by the input
  // identifier (here the navIdent), but UserName expects keying by github_username.
  const mappingsByUsername = new Map<string, UserMapping>()
  const navIdentToUsername: Record<string, string> = {}
  for (const [navIdent, mapping] of mappingsByIdent) {
    if (mapping.github_username) {
      mappingsByUsername.set(mapping.github_username, mapping)
      navIdentToUsername[navIdent] = mapping.github_username
    }
  }
  // serializeUserMappings strips fields the UI does not need (e.g. nav_email,
  // slack_member_id, timestamps) before sending to the client.
  const userMappings: UserMappings = serializeUserMappings(mappingsByUsername)

  return { summary, userMappings, navIdentToUsername }
}

export async function action({ request }: Route.ActionArgs): Promise<ActionResult> {
  await requireAdmin(request)
  const formData = await request.formData()
  const intent = formData.get('intent')

  try {
    switch (intent) {
      case 'restore-user-mapping': {
        const githubUsername = String(formData.get('github_username') ?? '').trim()
        if (!githubUsername) return fail('Mangler GitHub-brukernavn.')
        const restored = await restoreUserMapping(githubUsername)
        return restored
          ? ok(`Brukermapping for ${githubUsername} er gjenopprettet.`)
          : fail('Mappingen finnes ikke eller er allerede aktiv.')
      }
      case 'restore-deployment-comment': {
        const id = parseId(formData.get('id'))
        if (id === null) return fail('Ugyldig kommentar-ID.')
        const restored = await restoreDeploymentComment(id)
        return restored ? ok('Kommentaren er gjenopprettet.') : fail('Kommentaren finnes ikke eller er allerede aktiv.')
      }
      case 'restore-dev-team-application': {
        const devTeamId = parseId(formData.get('dev_team_id'))
        const monitoredAppId = parseId(formData.get('monitored_app_id'))
        if (devTeamId === null || monitoredAppId === null) return fail('Ugyldig ID.')
        const restored = await restoreDevTeamApplication(devTeamId, monitoredAppId)
        return restored
          ? ok('Team-applikasjonskoblingen er gjenopprettet.')
          : fail('Koblingen finnes ikke eller er allerede aktiv.')
      }
      case 'restore-section-team': {
        const sectionId = parseId(formData.get('section_id'))
        const teamSlug = String(formData.get('team_slug') ?? '').trim()
        if (sectionId === null || !teamSlug) return fail('Ugyldig ID eller team-slug.')
        const restored = await restoreSectionTeam(sectionId, teamSlug)
        return restored
          ? ok('Seksjon-team-koblingen er gjenopprettet.')
          : fail('Koblingen finnes ikke eller er allerede aktiv.')
      }
      case 'restore-dev-team-nais-team': {
        const devTeamId = parseId(formData.get('dev_team_id'))
        const naisTeamSlug = String(formData.get('nais_team_slug') ?? '').trim()
        if (devTeamId === null || !naisTeamSlug) return fail('Ugyldig ID eller nais-team-slug.')
        const restored = await restoreDevTeamNaisTeam(devTeamId, naisTeamSlug)
        return restored
          ? ok('Team-nais-team-koblingen er gjenopprettet.')
          : fail('Koblingen finnes ikke eller er allerede aktiv.')
      }
      case 'restore-external-reference': {
        const id = parseId(formData.get('id'))
        if (id === null) return fail('Ugyldig referanse-ID.')
        try {
          const restored = await restoreExternalReference(id)
          return restored
            ? ok('Den eksterne lenken er gjenopprettet.')
            : fail('Lenken finnes ikke eller er allerede aktiv.')
        } catch (e) {
          return fail(e instanceof Error ? e.message : 'Klarte ikke å gjenopprette den eksterne lenken.')
        }
      }
      default:
        return fail('Ukjent handling.')
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Klarte ikke å gjenopprette raden.')
  }
}

function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })
}

function DeletedBy({
  navIdent,
  userMappings,
  navIdentToUsername,
}: {
  navIdent: string | null
  userMappings: UserMappings
  navIdentToUsername: Record<string, string>
}) {
  if (!navIdent) return <Detail textColor="subtle">Ukjent</Detail>
  const username = navIdentToUsername[navIdent]
  if (username) {
    return <UserName username={username} userMappings={userMappings} link={false} />
  }
  return <span>{navIdent}</span>
}

export default function AdminSoftDeleted() {
  const { summary, userMappings, navIdentToUsername } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  const totalCount =
    summary.userMappings.length +
    summary.deploymentComments.length +
    summary.devTeamApplications.length +
    summary.sectionTeams.length +
    summary.devTeamNaisTeams.length +
    summary.externalReferences.length

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Slettede rader
        </Heading>
        <BodyShort textColor="subtle">
          Oversikt over logisk slettede rader i auditrelaterte tabeller. Du kan gjenopprette en rad ved å trykke
          «Gjenopprett» — bevart historikk om hvem som slettet og når går tapt etter gjenoppretting.
        </BodyShort>
      </div>

      <ActionAlert data={actionData} />

      {totalCount === 0 && <Alert variant="info">Ingen slettede rader for øyeblikket.</Alert>}

      <Section title="Brukermappinger" count={summary.userMappings.length} emptyText="Ingen slettede brukermappinger.">
        {summary.userMappings.length > 0 && (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">GitHub-bruker</Table.HeaderCell>
                <Table.HeaderCell scope="col">Visningsnavn</Table.HeaderCell>
                <Table.HeaderCell scope="col">NAV-ident</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet av</Table.HeaderCell>
                <Table.HeaderCell scope="col" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {summary.userMappings.map((row) => (
                <Table.Row key={row.github_username}>
                  <Table.DataCell>{row.github_username}</Table.DataCell>
                  <Table.DataCell>{row.display_name ?? '—'}</Table.DataCell>
                  <Table.DataCell>{row.nav_ident ?? '—'}</Table.DataCell>
                  <Table.DataCell>{formatDate(row.deleted_at)}</Table.DataCell>
                  <Table.DataCell>
                    <DeletedBy
                      navIdent={row.deleted_by}
                      userMappings={userMappings}
                      navIdentToUsername={navIdentToUsername}
                    />
                  </Table.DataCell>
                  <Table.DataCell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore-user-mapping" />
                      <input type="hidden" name="github_username" value={row.github_username} />
                      <RestoreButton />
                    </Form>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Section>

      <Section
        title="Deployment-kommentarer"
        count={summary.deploymentComments.length}
        emptyText="Ingen slettede kommentarer."
      >
        {summary.deploymentComments.length > 0 && (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                <Table.HeaderCell scope="col">Type</Table.HeaderCell>
                <Table.HeaderCell scope="col">Tekst</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet av</Table.HeaderCell>
                <Table.HeaderCell scope="col" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {summary.deploymentComments.map((row) => (
                <Table.Row key={row.id}>
                  <Table.DataCell>
                    <BodyShort size="small">{row.app_name}</BodyShort>
                    <Detail textColor="subtle">
                      {row.team_slug} / {row.environment_name}
                    </Detail>
                  </Table.DataCell>
                  <Table.DataCell>
                    <Tag size="small" variant="info">
                      {row.comment_type}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>{row.body_excerpt}</Table.DataCell>
                  <Table.DataCell>{formatDate(row.deleted_at)}</Table.DataCell>
                  <Table.DataCell>
                    <DeletedBy
                      navIdent={row.deleted_by}
                      userMappings={userMappings}
                      navIdentToUsername={navIdentToUsername}
                    />
                  </Table.DataCell>
                  <Table.DataCell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore-deployment-comment" />
                      <input type="hidden" name="id" value={row.id} />
                      <RestoreButton />
                    </Form>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Section>

      <Section
        title="Team-applikasjon-koblinger"
        count={summary.devTeamApplications.length}
        emptyText="Ingen slettede team-applikasjon-koblinger."
      >
        {summary.devTeamApplications.length > 0 && (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Utviklerteam</Table.HeaderCell>
                <Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet av</Table.HeaderCell>
                <Table.HeaderCell scope="col" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {summary.devTeamApplications.map((row) => (
                <Table.Row key={`${row.dev_team_id}:${row.monitored_app_id}`}>
                  <Table.DataCell>{row.dev_team_name}</Table.DataCell>
                  <Table.DataCell>
                    <BodyShort size="small">{row.app_name}</BodyShort>
                    <Detail textColor="subtle">
                      {row.team_slug} / {row.environment_name}
                    </Detail>
                  </Table.DataCell>
                  <Table.DataCell>{formatDate(row.deleted_at)}</Table.DataCell>
                  <Table.DataCell>
                    <DeletedBy
                      navIdent={row.deleted_by}
                      userMappings={userMappings}
                      navIdentToUsername={navIdentToUsername}
                    />
                  </Table.DataCell>
                  <Table.DataCell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore-dev-team-application" />
                      <input type="hidden" name="dev_team_id" value={row.dev_team_id} />
                      <input type="hidden" name="monitored_app_id" value={row.monitored_app_id} />
                      <RestoreButton />
                    </Form>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Section>

      <Section
        title="Seksjon-team-koblinger"
        count={summary.sectionTeams.length}
        emptyText="Ingen slettede seksjon-team-koblinger."
      >
        {summary.sectionTeams.length > 0 && (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Seksjon</Table.HeaderCell>
                <Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet av</Table.HeaderCell>
                <Table.HeaderCell scope="col" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {summary.sectionTeams.map((row) => (
                <Table.Row key={`${row.section_id}:${row.team_slug}`}>
                  <Table.DataCell>{row.section_name}</Table.DataCell>
                  <Table.DataCell>{row.team_slug}</Table.DataCell>
                  <Table.DataCell>{formatDate(row.deleted_at)}</Table.DataCell>
                  <Table.DataCell>
                    <DeletedBy
                      navIdent={row.deleted_by}
                      userMappings={userMappings}
                      navIdentToUsername={navIdentToUsername}
                    />
                  </Table.DataCell>
                  <Table.DataCell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore-section-team" />
                      <input type="hidden" name="section_id" value={row.section_id} />
                      <input type="hidden" name="team_slug" value={row.team_slug} />
                      <RestoreButton />
                    </Form>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Section>

      <Section
        title="Utviklerteam-nais-team-koblinger"
        count={summary.devTeamNaisTeams.length}
        emptyText="Ingen slettede utviklerteam-nais-team-koblinger."
      >
        {summary.devTeamNaisTeams.length > 0 && (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Utviklerteam</Table.HeaderCell>
                <Table.HeaderCell scope="col">Nais-team</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet av</Table.HeaderCell>
                <Table.HeaderCell scope="col" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {summary.devTeamNaisTeams.map((row) => (
                <Table.Row key={`${row.dev_team_id}:${row.nais_team_slug}`}>
                  <Table.DataCell>{row.dev_team_name}</Table.DataCell>
                  <Table.DataCell>{row.nais_team_slug}</Table.DataCell>
                  <Table.DataCell>{formatDate(row.deleted_at)}</Table.DataCell>
                  <Table.DataCell>
                    <DeletedBy
                      navIdent={row.deleted_by}
                      userMappings={userMappings}
                      navIdentToUsername={navIdentToUsername}
                    />
                  </Table.DataCell>
                  <Table.DataCell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore-dev-team-nais-team" />
                      <input type="hidden" name="dev_team_id" value={row.dev_team_id} />
                      <input type="hidden" name="nais_team_slug" value={row.nais_team_slug} />
                      <RestoreButton />
                    </Form>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Section>

      <Section
        title="Eksterne lenker"
        count={summary.externalReferences.length}
        emptyText="Ingen slettede eksterne lenker."
      >
        {summary.externalReferences.length > 0 && (
          <Table size="small">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell scope="col">Knyttet til</Table.HeaderCell>
                <Table.HeaderCell scope="col">Type</Table.HeaderCell>
                <Table.HeaderCell scope="col">URL</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet</Table.HeaderCell>
                <Table.HeaderCell scope="col">Slettet av</Table.HeaderCell>
                <Table.HeaderCell scope="col" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {summary.externalReferences.map((row) => (
                <Table.Row key={row.id}>
                  <Table.DataCell>
                    <BodyShort size="small">{row.parent_label}</BodyShort>
                    {!row.parent_active && (
                      <Detail textColor="subtle">⚠️ Forelder er deaktivert — kan ikke gjenopprettes</Detail>
                    )}
                  </Table.DataCell>
                  <Table.DataCell>
                    <Tag size="small" variant="info">
                      {row.ref_type}
                    </Tag>
                  </Table.DataCell>
                  <Table.DataCell>
                    {isSafeHttpUrl(row.url) ? (
                      <ExternalLink href={row.url}>{row.title || row.url}</ExternalLink>
                    ) : (
                      <span>{row.title || row.url}</span>
                    )}
                  </Table.DataCell>
                  <Table.DataCell>{formatDate(row.deleted_at)}</Table.DataCell>
                  <Table.DataCell>
                    <DeletedBy
                      navIdent={row.deleted_by}
                      userMappings={userMappings}
                      navIdentToUsername={navIdentToUsername}
                    />
                  </Table.DataCell>
                  <Table.DataCell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore-external-reference" />
                      <input type="hidden" name="id" value={row.id} />
                      <RestoreButton disabled={!row.parent_active} />
                    </Form>
                  </Table.DataCell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Section>
    </VStack>
  )
}

function Section({
  title,
  count,
  emptyText,
  children,
}: {
  title: string
  count: number
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-12">
        <HStack gap="space-8" align="center" justify="space-between">
          <Heading level="2" size="small">
            {title}
          </Heading>
          <Tag size="small" variant={count > 0 ? 'warning' : 'neutral'}>
            {count}
          </Tag>
        </HStack>
        {count === 0 ? <BodyShort textColor="subtle">{emptyText}</BodyShort> : children}
      </VStack>
    </Box>
  )
}

function RestoreButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button type="submit" size="small" variant="secondary" icon={<ArrowUndoIcon aria-hidden />} disabled={disabled}>
      Gjenopprett
    </Button>
  )
}
