import { BodyShort, Box, Button, Heading, TextField, VStack } from '@navikt/ds-react'
import { Form, useActionData, useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { getDeviationSlackChannel, updateDeviationSlackChannel } from '~/db/global-settings.server'
import { fail, ok } from '~/lib/action-result'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/global-settings'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Globale innstillinger - Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const deviationChannel = await getDeviationSlackChannel()
  return { deviationChannel }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'update_deviation_channel') {
    const channelId = (formData.get('channel_id') as string)?.trim() || ''
    try {
      await updateDeviationSlackChannel(channelId)
      return ok('Avvikskanal oppdatert')
    } catch (_error) {
      return fail('Kunne ikke oppdatere avvikskanal')
    }
  }

  return fail('Ukjent handling')
}

export default function GlobalSettingsPage() {
  const { deviationChannel } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-24">
        <Heading level="1" size="large">
          Globale innstillinger
        </Heading>

        <ActionAlert data={actionData} />

        <Box background="neutral-soft" padding="space-24" borderRadius="8">
          <VStack gap="space-16">
            <Heading level="2" size="small">
              Slack-kanal for avvik
            </Heading>
            <BodyShort>
              Konfigurer hvilken Slack-kanal som skal motta varsler når avvik registreres på deployments. Kanalen er
              global for alle applikasjoner.
            </BodyShort>

            <Form method="post">
              <input type="hidden" name="intent" value="update_deviation_channel" />
              <VStack gap="space-16">
                <TextField
                  name="channel_id"
                  label="Kanal-ID"
                  description="Finn kanal-ID ved å høyreklikke på kanalen i Slack → View channel details → scroll ned"
                  placeholder="C0123456789"
                  defaultValue={deviationChannel.channel_id}
                  style={{ maxWidth: '400px' }}
                />
                <Button type="submit" variant="primary">
                  Lagre
                </Button>
              </VStack>
            </Form>
          </VStack>
        </Box>
      </VStack>
    </Box>
  )
}
