import { ChatIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Heading, HStack, Switch, TextField, VStack } from '@navikt/ds-react'
import { Form, Link } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type SlackConfigSettingsProps = {
  app: LoaderData['app']
}

export function SlackConfigSettings({ app }: SlackConfigSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <HStack gap="space-8" align="center" justify="space-between">
          <HStack gap="space-8" align="center">
            <ChatIcon aria-hidden fontSize="1.25rem" />
            <div>
              <Heading size="small" level="2">
                Slack-varsler
              </Heading>
              <BodyShort textColor="subtle" size="small">
                Konfigurer Slack-varsler for ikke-godkjente deployments.
              </BodyShort>
            </div>
          </HStack>
          <Button
            as={Link}
            to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/slack`}
            variant="tertiary"
            size="small"
          >
            Se meldingshistorikk
          </Button>
        </HStack>

        <Form method="post">
          <input type="hidden" name="action" value="update_slack_config" />
          <input type="hidden" name="app_id" value={app.id} />
          <VStack gap="space-16">
            <Switch name="slack_notifications_enabled" value="true" defaultChecked={app.slack_notifications_enabled}>
              Aktiver Slack-varsler for denne appen
            </Switch>

            <TextField
              label="Slack-kanal"
              name="slack_channel_id"
              defaultValue={app.slack_channel_id || ''}
              description="Kanal-ID (f.eks. C01234567) eller kanalnavn (f.eks. #min-kanal)"
              size="small"
              style={{ maxWidth: '300px' }}
            />

            <Button type="submit" size="small" variant="secondary">
              Lagre Slack-innstillinger
            </Button>
          </VStack>
        </Form>
      </VStack>
    </Box>
  )
}
