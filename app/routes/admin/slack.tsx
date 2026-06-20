import { Alert, BodyShort, Box, Button, Heading, HStack, TextField, VStack } from '@navikt/ds-react'
import { Form, useActionData, useLoaderData } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import { requireAdmin } from '~/lib/auth.server'
import type { DeploymentNotification } from '~/lib/slack'
import { isSlackConfigured, sendDeploymentNotification } from '~/lib/slack/client.server'
import type { Route } from './+types/slack'

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  return {
    isConfigured: isSlackConfigured(),
    channelId: process.env.SLACK_CHANNEL_ID || '',
    hasBotToken: !!process.env.SLACK_BOT_TOKEN,
    hasAppToken: !!process.env.SLACK_APP_TOKEN,
  }
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request)

  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'test') {
    const channelId = formData.get('channelId') as string

    if (!channelId) {
      return { success: false, error: 'Kanal-ID er påkrevd' }
    }

    const testNotification: DeploymentNotification = {
      deploymentId: 0,
      appName: 'test-app',
      environmentName: 'dev',
      teamSlug: 'test-team',
      commitSha: 'abc1234567890',
      commitMessage: 'Test commit message for Slack integration',
      deployerName: 'Test Bruker',
      deployerUsername: 'T123456',
      prNumber: 1234,
      prUrl: 'https://github.com/navikt/test-app/pull/1234',
      status: 'unverified',
      detailsUrl: 'https://nda.ansatt.nav.no',
    }

    try {
      const messageTs = await sendDeploymentNotification(testNotification, channelId)

      if (messageTs) {
        return { success: true, messageTs }
      }
      return { success: false, error: 'Kunne ikke sende melding - sjekk server-logger' }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Ukjent feil',
      }
    }
  }

  return { success: false, error: 'Ukjent handling' }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Slack-integrasjon - Admin' }]
}

export default function SlackAdminPage() {
  const { isConfigured, channelId, hasBotToken, hasAppToken } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return (
    <Box paddingBlock="space-8" paddingInline={{ xs: 'space-4', md: 'space-8' }}>
      <VStack gap="space-6">
        <Heading level="1" size="large">
          Slack-integrasjon
        </Heading>

        {/* Configuration status */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading level="2" size="small">
              Konfigurasjonsstatus
            </Heading>
            <HStack gap="space-8">
              <BodyShort>SLACK_BOT_TOKEN: {hasBotToken ? '✅ Satt' : '❌ Mangler'}</BodyShort>
              <BodyShort>SLACK_APP_TOKEN: {hasAppToken ? '✅ Satt' : '❌ Mangler'}</BodyShort>
              <BodyShort>SLACK_CHANNEL_ID: {channelId ? `✅ ${channelId}` : '⚠️ Ikke satt'}</BodyShort>
            </HStack>
            {isConfigured ? (
              <Alert variant="success" size="small">
                Slack er konfigurert og Socket Mode-tilkobling skal være aktiv.
              </Alert>
            ) : (
              <Alert variant="warning" size="small">
                Slack er ikke fullstendig konfigurert. Sett SLACK_BOT_TOKEN og SLACK_APP_TOKEN.
              </Alert>
            )}
          </VStack>
        </Box>

        {/* Test notification */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading level="2" size="small">
              Test varsling
            </Heading>
            <BodyShort>Send en testmelding til en Slack-kanal for å verifisere at integrasjonen fungerer.</BodyShort>

            <Form method="post">
              <input type="hidden" name="intent" value="test" />
              <VStack gap="space-4">
                <TextField
                  name="channelId"
                  label="Kanal-ID"
                  description="Finn kanal-ID ved å høyreklikke på kanalen i Slack → View channel details → scroll ned"
                  placeholder="C0123456789"
                  defaultValue={channelId}
                  style={{ maxWidth: '300px' }}
                />
                <Button type="submit" variant="secondary" disabled={!isConfigured}>
                  Send testmelding
                </Button>
              </VStack>
            </Form>

            {actionData?.success && (
              <Alert variant="success">✅ Testmelding sendt! Message TS: {actionData.messageTs}</Alert>
            )}
            {actionData?.error && <Alert variant="error">❌ Feil: {actionData.error}</Alert>}
          </VStack>
        </Box>

        {/* Setup instructions */}
        <Box background="neutral-soft" padding="space-4" borderRadius="8">
          <VStack gap="space-4">
            <Heading level="2" size="small">
              Oppsett av Slack App
            </Heading>
            <ol style={{ paddingLeft: 'var(--ax-space-24)', margin: 0 }}>
              <li>
                Gå til <ExternalLink href="https://api.slack.com/apps">api.slack.com/apps</ExternalLink>
              </li>
              <li>Klikk "Create New App" → "From scratch"</li>
              <li>Gi appen et navn og velg workspace</li>
              <li>
                Under "Socket Mode" → Enable Socket Mode → Generate token med <code>connections:write</code> scope
              </li>
              <li>
                Lagre token som <code>SLACK_APP_TOKEN</code> (starter med <code>xapp-</code>)
              </li>
              <li>
                Under "OAuth & Permissions" → Add scopes: <code>chat:write</code>, <code>chat:write.public</code>
              </li>
              <li>Install app to workspace</li>
              <li>
                Kopier "Bot User OAuth Token" som <code>SLACK_BOT_TOKEN</code> (starter med <code>xoxb-</code>)
              </li>
              <li>Under "Interactivity & Shortcuts" → Enable Interactivity (Socket Mode håndterer dette automatisk)</li>
            </ol>
          </VStack>
        </Box>
      </VStack>
    </Box>
  )
}
