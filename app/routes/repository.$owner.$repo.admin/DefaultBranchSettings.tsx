import { Box, Button, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { AffectedApp } from '~/db/repositories.server'
import { AffectedAppsList } from './AffectedAppsList'

type DefaultBranchSettingsProps = {
  repositoryId: number
  defaultBranch: string | null
  affectedApps: AffectedApp[]
}

export function DefaultBranchSettings({ repositoryId, defaultBranch, affectedApps }: DefaultBranchSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Heading size="small" level="2">
          Default branch
        </Heading>
        <Form method="post">
          <input type="hidden" name="action" value="update_default_branch" />
          <input type="hidden" name="repository_id" value={repositoryId} />
          <HStack gap="space-16" align="end" wrap>
            <TextField
              label="Branch"
              description="Branchen som PR-er må gå til for å bli godkjent (f.eks. main, master)"
              name="default_branch"
              defaultValue={defaultBranch ?? ''}
              size="small"
              style={{ minWidth: '200px' }}
            />
            <Button type="submit" size="small" variant="secondary">
              Lagre
            </Button>
          </HStack>
        </Form>
        <AffectedAppsList affectedApps={affectedApps} />
      </VStack>
    </Box>
  )
}
