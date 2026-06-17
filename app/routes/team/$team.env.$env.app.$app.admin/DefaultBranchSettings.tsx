import { Box, Button, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type DefaultBranchSettingsProps = {
  app: LoaderData['app']
}

export function DefaultBranchSettings({ app }: DefaultBranchSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Heading size="small" level="2">
          Default branch
        </Heading>
        <Form method="post">
          <input type="hidden" name="action" value="update_default_branch" />
          <input type="hidden" name="app_id" value={app.id} />
          <HStack gap="space-16" align="end" wrap>
            <TextField
              label="Branch"
              description="Branchen som PR-er må gå til for å bli godkjent (f.eks. main, master)"
              name="default_branch"
              defaultValue={app.default_branch ?? ''}
              size="small"
              style={{ minWidth: '200px' }}
            />
            <Button type="submit" size="small" variant="secondary">
              Lagre
            </Button>
          </HStack>
        </Form>
      </VStack>
    </Box>
  )
}
