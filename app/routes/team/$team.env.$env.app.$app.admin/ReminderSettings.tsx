import {
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Heading,
  HStack,
  Switch,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { Form } from 'react-router'
import type { Route } from '../+types/$team.env.$env.app.$app.admin'

type LoaderData = Route.ComponentProps['loaderData']

type ReminderSettingsProps = {
  app: LoaderData['app']
}

export function ReminderSettings({ app }: ReminderSettingsProps) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <div>
          <Heading size="small" level="2">
            Purring for ikke-godkjente deployments
          </Heading>
          <BodyShort textColor="subtle" size="small">
            Send automatiske påminnelser i Slack for deployments som mangler godkjenning.
          </BodyShort>
        </div>

        <Form method="post">
          <input type="hidden" name="action" value="update_reminder_config" />
          <input type="hidden" name="app_id" value={app.id} />
          <VStack gap="space-16">
            <Switch name="reminder_enabled" value="true" defaultChecked={app.reminder_enabled}>
              Aktiver automatisk purring
            </Switch>

            <TextField
              label="Tidspunkt"
              name="reminder_time"
              defaultValue={app.reminder_time || '09:00'}
              description="Klokkeslett for purring (HH:mm)"
              size="small"
              style={{ maxWidth: '150px' }}
            />

            <CheckboxGroup
              legend="Ukedager"
              description="Velg hvilke dager purringen skal sendes. Sendes kun på hverdager (ikke helligdager)."
              size="small"
              defaultValue={app.reminder_days || ['mon', 'tue', 'wed', 'thu', 'fri']}
            >
              <Checkbox name="reminder_days" value="mon">
                Mandag
              </Checkbox>
              <Checkbox name="reminder_days" value="tue">
                Tirsdag
              </Checkbox>
              <Checkbox name="reminder_days" value="wed">
                Onsdag
              </Checkbox>
              <Checkbox name="reminder_days" value="thu">
                Torsdag
              </Checkbox>
              <Checkbox name="reminder_days" value="fri">
                Fredag
              </Checkbox>
            </CheckboxGroup>

            <Button type="submit" size="small" variant="secondary">
              Lagre purre-innstillinger
            </Button>
          </VStack>
        </Form>

        <HStack gap="space-8">
          <Form method="post">
            <input type="hidden" name="action" value="send_reminder" />
            <input type="hidden" name="team_slug" value={app.team_slug} />
            <input type="hidden" name="environment_name" value={app.environment_name} />
            <input type="hidden" name="app_name" value={app.app_name} />
            <Button type="submit" size="small" variant="tertiary">
              Send purring nå
            </Button>
          </Form>
        </HStack>
      </VStack>
    </Box>
  )
}
