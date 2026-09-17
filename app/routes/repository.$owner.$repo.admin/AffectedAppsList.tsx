import { BodyShort, List, VStack } from '@navikt/ds-react'
import type { AffectedApp } from '~/db/repositories.server'

export function AffectedAppsList({ affectedApps }: { affectedApps: AffectedApp[] }) {
  if (affectedApps.length === 0) return null

  return (
    <VStack gap="space-8">
      <BodyShort size="small" textColor="subtle">
        Gjelder for {affectedApps.length} {affectedApps.length === 1 ? 'app' : 'apper'} i dette repoet:
      </BodyShort>
      <List size="small">
        {affectedApps.map((app) => (
          <List.Item key={app.id}>
            {app.team_slug}/{app.app_name} ({app.environment_name})
          </List.Item>
        ))}
      </List>
    </VStack>
  )
}
