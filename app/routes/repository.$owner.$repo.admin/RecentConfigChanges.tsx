import { Box, Detail, Label, VStack } from '@navikt/ds-react'
import type { RepoConfigAuditLogEntry } from '~/db/repositories.server'
import { formatAuditLogTimestamp, formatChangedBy } from '~/lib/app-config-audit-log-display'
import { repoConfigChangeDescription } from '~/lib/repo-config-audit-log-display'

export type RecentConfigChangesProps = {
  recentConfigChanges: RepoConfigAuditLogEntry[]
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
              {repoConfigChangeDescription(change.setting_key, change.old_value, change.new_value)}
            </Detail>
          ))}
        </VStack>
      </VStack>
    </Box>
  )
}
