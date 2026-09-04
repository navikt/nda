import { Box, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import { RepoScopeSaveButton, RepoScopeWarning } from '~/components/RepoScopeSettings'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type DefaultBranchSettingsProps = {
  app: LoaderData['app']
  defaultBranch: LoaderData['defaultBranch']
  affectedApps: LoaderData['affectedApps']
}

const FORM_ID = 'default-branch-form'

export function DefaultBranchSettings({ app, defaultBranch, affectedApps }: DefaultBranchSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <Heading size="small" level="2">
          Default branch
        </Heading>
        <RepoScopeWarning affectedApps={affectedApps} currentAppId={app.id} />
        <Form method="post" id={FORM_ID}>
          <input type="hidden" name="action" value="update_default_branch" />
          <input type="hidden" name="app_id" value={app.id} />
          <HStack gap="space-16" align="end" wrap>
            <TextField
              label="Branch"
              description="Branchen som PR-er må gå til for å bli godkjent (f.eks. main, master)"
              name="default_branch"
              defaultValue={defaultBranch ?? ''}
              size="small"
              style={{ minWidth: '200px' }}
            />
            <RepoScopeSaveButton
              affectedApps={affectedApps}
              currentAppId={app.id}
              formId={FORM_ID}
              settingLabel="default branch"
            />
          </HStack>
        </Form>
      </VStack>
    </Box>
  )
}
