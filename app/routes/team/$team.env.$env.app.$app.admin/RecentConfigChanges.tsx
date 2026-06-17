import { Box, Detail, Label, VStack } from '@navikt/ds-react'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']
export type RecentConfigChangesProps = {
  recentConfigChanges: LoaderData['recentConfigChanges']
}

export function RecentConfigChanges({ recentConfigChanges }: RecentConfigChangesProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Label>Siste endringer</Label>
        <VStack gap="space-4">
          {recentConfigChanges.map((change) => (
            <Detail key={change.id} textColor="subtle">
              {new Date(change.created_at).toLocaleString('no-NO')} -{' '}
              {change.changed_by_name || change.changed_by_nav_ident}: {change.setting_key}
            </Detail>
          ))}
        </VStack>
      </VStack>
    </Box>
  )
}
