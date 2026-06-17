import { BodyShort, Box, Button, Heading, Switch, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type DeployNotificationSettingsProps = {
  app: LoaderData['app']
}

export function DeployNotificationSettings({ app }: DeployNotificationSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Deployment-varsler
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Send automatiske varsler til Slack når nye deployments oppdages. Inkluderer PR-tittel, hvem som opprettet,
            godkjente og merget PR-en.
          </BodyShort>
        </div>

        <Form method="post">
          <input type="hidden" name="action" value="update_slack_deploy_config" />
          <input type="hidden" name="app_id" value={app.id} />
          <VStack gap="space-16">
            <Switch name="slack_deploy_notify_enabled" value="true" defaultChecked={app.slack_deploy_notify_enabled}>
              Aktiver deployment-varsler for denne appen
            </Switch>

            <TextField
              label="Slack-kanal for deployment-varsler"
              name="slack_deploy_channel_id"
              defaultValue={app.slack_deploy_channel_id || ''}
              description="Kanal-ID (f.eks. C01234567) eller kanalnavn (f.eks. #min-kanal). Kan være en annen kanal enn for avviksvarsler."
              size="small"
              style={{ maxWidth: '300px' }}
            />

            <Button type="submit" size="small" variant="secondary">
              Lagre deployment-varsler
            </Button>
          </VStack>
        </Form>
      </VStack>
    </Box>
  )
}
