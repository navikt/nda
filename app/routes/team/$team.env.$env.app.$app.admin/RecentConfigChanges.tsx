import { Box, Detail, Label, VStack } from '@navikt/ds-react'
import { configSettingLabel, formatAuditLogTimestamp, formatChangedBy } from '~/lib/app-config-audit-log-display'
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
              {formatAuditLogTimestamp(change.created_at)} -{' '}
              {formatChangedBy(change.changed_by_name, change.changed_by_nav_ident)}:{' '}
              {configSettingLabel(change.setting_key)}
            </Detail>
          ))}
        </VStack>
      </VStack>
    </Box>
  )
}
