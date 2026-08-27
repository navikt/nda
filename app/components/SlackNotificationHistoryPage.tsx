import { ChatIcon, ClockIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Detail,
  Heading,
  HStack,
  Table,
  Tag,
  ToggleGroup,
  VStack,
} from '@navikt/ds-react'
import { Link, useSearchParams } from 'react-router'
import { NotificationTypeTag, type SlackNotificationType } from '~/components/slack-notification-tags'
import { configChangeDescription, formatAuditLogTimestamp, formatChangedBy } from '~/lib/app-config-audit-log-display'
import type { SlackConfigSettingKey } from '~/lib/slack/config-setting-keys'
import { SLACK_NOTIFICATION_TYPES } from '~/lib/slack/notification-type'

type NotificationTypeFilter = 'all' | SlackNotificationType

const NOTIFICATION_TYPE_FILTER_VALUES: readonly NotificationTypeFilter[] = ['all', ...SLACK_NOTIFICATION_TYPES]

function isNotificationTypeFilter(value: string | null): value is NotificationTypeFilter {
  return (NOTIFICATION_TYPE_FILTER_VALUES as readonly string[]).includes(value ?? '')
}

const CONFIG_SETTING_TO_NOTIFICATION_TYPE: Record<SlackConfigSettingKey, SlackNotificationType> = {
  slack_notifications_enabled: 'approval',
  slack_deploy_notify_enabled: 'deploy',
}

export interface SlackNotificationHistoryApp {
  app_name: string
  environment_name: string
  team_slug: string
  slack_notifications_enabled: boolean
  slack_channel_id: string | null
  slack_deploy_notify_enabled: boolean
  slack_deploy_channel_id: string | null
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

export interface SlackConfigChangeEntry {
  id: number
  setting_key: SlackConfigSettingKey
  changed_by_nav_ident: string
  changed_by_name: string | null
  old_value?: { enabled?: boolean; channel_id?: string | null } | null
  new_value: { enabled?: boolean; channel_id?: string | null }
  created_at: Date | string
}

interface SlackNotificationHistoryPageProps {
  app: SlackNotificationHistoryApp
  notifications: SlackNotificationHistoryEntry[]
  configChanges?: SlackConfigChangeEntry[]
}

export function SlackNotificationHistoryPage({
  app,
  notifications,
  configChanges = [],
}: SlackNotificationHistoryPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTypeFilter = searchParams.get('type')
  const typeFilter: NotificationTypeFilter = isNotificationTypeFilter(rawTypeFilter) ? rawTypeFilter : 'all'

  const filteredNotifications =
    typeFilter === 'all' ? notifications : notifications.filter((n) => n.notification_type === typeFilter)

  const filteredConfigChanges =
    typeFilter === 'all'
      ? configChanges
      : configChanges.filter((change) => CONFIG_SETTING_TO_NOTIFICATION_TYPE[change.setting_key] === typeFilter)

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
          <VStack gap="space-8">
            <HStack gap="space-16" align="center">
              <BodyShort weight="semibold">Godkjenningsvarsler:</BodyShort>
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
            <HStack gap="space-16" align="center">
              <BodyShort weight="semibold">Deployment-varsler:</BodyShort>
              {app.slack_deploy_notify_enabled ? (
                <Tag data-color="success" variant="moderate" size="small">
                  Aktivert
                </Tag>
              ) : (
                <Tag data-color="neutral" variant="moderate" size="small">
                  Deaktivert
                </Tag>
              )}
              {app.slack_deploy_channel_id && <Detail textColor="subtle">Kanal: {app.slack_deploy_channel_id}</Detail>}
            </HStack>
          </VStack>
        </Box>

        <ToggleGroup
          value={typeFilter}
          onChange={(value) => {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev)
                if (value === 'all') {
                  next.delete('type')
                } else {
                  next.set('type', value)
                }
                return next
              },
              { replace: true },
            )
          }}
          size="small"
          label="Filtrer på varseltype"
        >
          <ToggleGroup.Item value="all">Begge</ToggleGroup.Item>
          <ToggleGroup.Item value="deploy">Deployment-varsel</ToggleGroup.Item>
          <ToggleGroup.Item value="approval">Godkjenningsvarsel</ToggleGroup.Item>
        </ToggleGroup>

        {filteredConfigChanges.length > 0 && (
          <VStack gap="space-8">
            <Heading level="2" size="small">
              Konfigurasjonsendringer ({filteredConfigChanges.length})
            </Heading>
            <Detail textColor="subtle">
              Endringer i Slack-varslingsinnstillinger, hentet fra revisjonsloggen. Kan forklare hvorfor det ikke ble
              sendt meldinger i en gitt periode.
            </Detail>
            <Box padding="space-16" background="raised" borderRadius="8">
              <VStack gap="space-4">
                {filteredConfigChanges.map((change) => (
                  <Detail key={change.id} textColor="subtle">
                    {formatAuditLogTimestamp(change.created_at)} -{' '}
                    {formatChangedBy(change.changed_by_name, change.changed_by_nav_ident)}:{' '}
                    {configChangeDescription(change.setting_key, change.old_value, change.new_value)}
                  </Detail>
                ))}
              </VStack>
            </Box>
          </VStack>
        )}

        {filteredNotifications.length === 0 ? (
          <Alert variant="info">
            {notifications.length === 0
              ? 'Ingen Slack-meldinger er sendt for denne applikasjonen ennå.'
              : 'Ingen Slack-meldinger av valgt type er sendt for denne applikasjonen.'}
          </Alert>
        ) : (
          <VStack gap="space-16">
            <Heading level="2" size="small">
              Meldingshistorikk ({filteredNotifications.length})
            </Heading>

            <Table size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell />
                  <Table.HeaderCell>Tidspunkt</Table.HeaderCell>
                  <Table.HeaderCell>Type</Table.HeaderCell>
                  <Table.HeaderCell>Deployment</Table.HeaderCell>
                  <Table.HeaderCell>Sendt av</Table.HeaderCell>
                  <Table.HeaderCell>Oppdateringer</Table.HeaderCell>
                  <Table.HeaderCell>Interaksjoner</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {filteredNotifications.map((notification) => (
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
                                    <Detail textColor="subtle">{formatAuditLogTimestamp(update.created_at)}</Detail>
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
                                    <Detail textColor="subtle">
                                      {formatAuditLogTimestamp(interaction.created_at)}
                                    </Detail>
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
                    <Table.DataCell>{formatAuditLogTimestamp(notification.sent_at)}</Table.DataCell>
                    <Table.DataCell>
                      <NotificationTypeTag notificationType={notification.notification_type} />
                    </Table.DataCell>
                    <Table.DataCell>
                      {notification.deployment_id ? (
                        <AkselLink
                          as={Link}
                          to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/deployments/${notification.deployment_id}`}
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
