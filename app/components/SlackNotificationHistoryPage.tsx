import { ChatIcon, ClockIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, Alert, BodyShort, Box, Detail, Heading, HStack, Table, Tag, VStack } from '@navikt/ds-react'
import { NotificationTypeTag } from '~/components/slack-notification-tags'
import type { SlackNotificationType } from '~/db/slack-notifications.server'

export interface SlackNotificationHistoryApp {
  app_name: string
  environment_name: string
  team_slug: string
  slack_notifications_enabled: boolean
  slack_channel_id: string | null
}

export interface SlackNotificationHistoryEntry {
  id: number
  notification_type: SlackNotificationType
  deployment_id: number | null
  deployment_commit_sha: string | null
  sent_at: Date | string
  sent_by: string | null
  message_text: string | null
  update_count: number
  interaction_count: number
  updates: {
    id: number
    created_at: Date | string
    action: string
    triggered_by: string | null
  }[]
  interactions: {
    id: number
    created_at: Date | string
    action_id: string
    slack_user_id: string
    slack_username: string | null
  }[]
}

function formatDate(date: Date | string | null): string {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface SlackNotificationHistoryPageProps {
  app: SlackNotificationHistoryApp
  notifications: SlackNotificationHistoryEntry[]
}

export function SlackNotificationHistoryPage({ app, notifications }: SlackNotificationHistoryPageProps) {
  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-24">
      <VStack gap="space-24">
        <VStack gap="space-8">
          <Heading level="1" size="large">
            Slack-kommunikasjon
          </Heading>
          <Detail textColor="subtle">
            {app.app_name} • {app.environment_name}
          </Detail>
        </VStack>

        <Box padding="space-16" background="raised" borderRadius="8">
          <HStack gap="space-16" align="center">
            <BodyShort weight="semibold">Slack-konfigurasjon:</BodyShort>
            {app.slack_notifications_enabled ? (
              <Tag data-color="success" variant="moderate" size="small">
                Aktivert
              </Tag>
            ) : (
              <Tag data-color="neutral" variant="moderate" size="small">
                Deaktivert
              </Tag>
            )}
            {app.slack_channel_id && <Detail textColor="subtle">Kanal: {app.slack_channel_id}</Detail>}
          </HStack>
        </Box>

        {notifications.length === 0 ? (
          <Alert variant="info">Ingen Slack-meldinger er sendt for denne applikasjonen ennå.</Alert>
        ) : (
          <VStack gap="space-16">
            <Heading level="2" size="small">
              Meldingshistorikk ({notifications.length})
            </Heading>

            <Table size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
                  <Table.HeaderCell>Type</Table.HeaderCell>
                  <Table.HeaderCell>Deployment</Table.HeaderCell>
                  <Table.HeaderCell>Sendt av</Table.HeaderCell>
                  <Table.HeaderCell>Oppdateringer</Table.HeaderCell>
                  <Table.HeaderCell>Interaksjoner</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {notifications.map((notification) => (
                  <Table.ExpandableRow
                    key={notification.id}
                    content={
                      <VStack gap="space-16" padding="space-16">
                        {notification.updates.length > 0 && (
                          <VStack gap="space-8">
                            <HStack gap="space-4" align="center">
                              <ClockIcon aria-hidden />
                              <BodyShort weight="semibold" size="small">
                                Hendelser ({notification.updates.length})
                              </BodyShort>
                            </HStack>
                            <Box background="sunken" padding="space-12" borderRadius="4">
                              <VStack gap="space-8">
                                {notification.updates.map((update) => (
                                  <HStack key={update.id} gap="space-8" align="center">
                                    <Detail textColor="subtle">{formatDate(update.created_at)}</Detail>
                                    <Tag size="xsmall" variant="outline">
                                      {update.action}
                                    </Tag>
                                    {update.triggered_by && (
                                      <Detail textColor="subtle">av {update.triggered_by}</Detail>
                                    )}
                                  </HStack>
                                ))}
                              </VStack>
                            </Box>
                          </VStack>
                        )}

                        {notification.interactions.length > 0 && (
                          <VStack gap="space-8">
                            <HStack gap="space-4" align="center">
                              <ChatIcon aria-hidden />
                              <BodyShort weight="semibold" size="small">
                                Interaksjoner ({notification.interactions.length})
                              </BodyShort>
                            </HStack>
                            <Box background="sunken" padding="space-12" borderRadius="4">
                              <VStack gap="space-8">
                                {notification.interactions.map((interaction) => (
                                  <HStack key={interaction.id} gap="space-8" align="center">
                                    <Detail textColor="subtle">{formatDate(interaction.created_at)}</Detail>
                                    <Tag size="xsmall" variant="outline">
                                      {interaction.action_id}
                                    </Tag>
                                    <Detail>{interaction.slack_username || interaction.slack_user_id}</Detail>
                                  </HStack>
                                ))}
                              </VStack>
                            </Box>
                          </VStack>
                        )}

                        {notification.message_text && (
                          <VStack gap="space-8">
                            <BodyShort weight="semibold" size="small">
                              Melding
                            </BodyShort>
                            <Box background="sunken" padding="space-12" borderRadius="4">
                              <BodyShort size="small" style={{ whiteSpace: 'pre-wrap' }}>
                                {notification.message_text}
                              </BodyShort>
                            </Box>
                          </VStack>
                        )}
                      </VStack>
                    }
                  >
                    <Table.DataCell>{formatDate(notification.sent_at)}</Table.DataCell>
                    <Table.DataCell>
                      <NotificationTypeTag notificationType={notification.notification_type} />
                    </Table.DataCell>
                    <Table.DataCell>
                      {notification.deployment_id ? (
                        <AkselLink
                          href={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/deployments/${notification.deployment_id}`}
                        >
                          {notification.deployment_commit_sha?.substring(0, 7) || `#${notification.deployment_id}`}
                        </AkselLink>
                      ) : (
                        '-'
                      )}
                    </Table.DataCell>
                    <Table.DataCell>{notification.sent_by || '-'}</Table.DataCell>
                    <Table.DataCell>
                      <HStack gap="space-4" align="center">
                        <ClockIcon aria-hidden fontSize="1rem" />
                        {notification.update_count}
                      </HStack>
                    </Table.DataCell>
                    <Table.DataCell>
                      <HStack gap="space-4" align="center">
                        <ChatIcon aria-hidden fontSize="1rem" />
                        {notification.interaction_count}
                      </HStack>
                    </Table.DataCell>
                  </Table.ExpandableRow>
                ))}
              </Table.Body>
            </Table>
          </VStack>
        )}
      </VStack>
    </Box>
  )
}
