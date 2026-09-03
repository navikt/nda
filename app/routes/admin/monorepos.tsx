import { LayersIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Tag, VStack } from '@navikt/ds-react'
import { Form, Link, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { applyAuditStartYearChange } from '~/db/audit-start-year-baseline.server'
import { getAllMonorepoGroups } from '~/db/monorepo.server'
import { fail, ok } from '~/lib/action-result'
import { resolveConsistentAuditStartYear } from '~/lib/audit-start-year-baseline'
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

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  const formData = await request.formData()
  const actionType = formData.get('action')

  if (actionType === 'sync_audit_start_year') {
    const rawAppId = formData.get('app_id')
    if (typeof rawAppId !== 'string' || !/^\d+$/.test(rawAppId)) {
      return fail('Fant ingen applikasjon å synkronisere')
    }
    const appId = parseInt(rawAppId, 10)
    if (!Number.isInteger(appId)) {
      return fail('Fant ingen applikasjon å synkronisere')
    }

    const groups = await getAllMonorepoGroups()
    const group = groups.find((g) => g.apps.some((app) => app.id === appId))
    if (!group) {
      return fail('Fant ingen monorepo-gruppe for denne applikasjonen')
    }

    const resolvedYear = resolveConsistentAuditStartYear(group.apps.map((app) => app.audit_start_year))
    const groupAppIds = new Set(group.apps.map((app) => app.id))
    const updatedGroupAppIds = new Set<number>()

    const trackUpdated = (ids: number[]) => {
      for (const id of ids) {
        if (groupAppIds.has(id)) updatedGroupAppIds.add(id)
      }
    }

    const preferredActingAppId = group.apps.find((app) => app.github_repo_id !== null)?.id ?? appId
    const initialResult = await applyAuditStartYearChange(preferredActingAppId, resolvedYear, admin.navIdent)
    trackUpdated(initialResult.updatedAppIds)

    for (const app of group.apps) {
      if (updatedGroupAppIds.size >= group.apps.length) break
      if (updatedGroupAppIds.has(app.id)) continue
      if (app.github_repo_id !== null) continue
      const retryResult = await applyAuditStartYearChange(app.id, resolvedYear, admin.navIdent)
      trackUpdated(retryResult.updatedAppIds)
    }

    const yearLabel = resolvedYear ? `startår ${resolvedYear}` : 'startår fjernet (ingen nedre grense)'
    if (updatedGroupAppIds.size < group.apps.length) {
      return ok(
        `Synkroniserte ${yearLabel} for ${updatedGroupAppIds.size} av ${group.apps.length} apper i repoet. Noen apper kunne ikke oppdateres automatisk (mangler github_repo_id, eller har et annet github_repo_id enn resten av gruppen) og må håndteres manuelt.`,
      )
    }

    return ok(`Synkroniserte ${yearLabel} for alle ${updatedGroupAppIds.size} apper i repoet`)
  }

  return fail('Ukjent handling')
}

export default function MonoreposAdmin({ actionData }: Route.ComponentProps) {
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

      <ActionAlert data={actionData} />

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
                </HStack>

                {(group.base_branch_mismatch || group.audit_year_mismatch) && (
                  <Alert variant="warning" size="small">
                    <VStack gap="space-8">
                      <span>
                        {group.base_branch_mismatch && group.audit_year_mismatch
                          ? 'Applikasjonene har ulik konfigurert base branch og ulikt revisjons-startår.'
                          : group.base_branch_mismatch
                            ? 'Applikasjonene har ulik konfigurert base branch.'
                            : 'Applikasjonene har ulikt revisjons-startår.'}
                      </span>
                      {group.audit_year_mismatch && (
                        <Form method="post">
                          <input type="hidden" name="action" value="sync_audit_start_year" />
                          <input type="hidden" name="app_id" value={group.apps[0].id} />
                          <Button type="submit" size="small" variant="secondary">
                            Synkroniser til{' '}
                            {resolveConsistentAuditStartYear(group.apps.map((a) => a.audit_start_year)) ??
                              'ingen nedre grense'}
                          </Button>
                        </Form>
                      )}
                    </VStack>
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
