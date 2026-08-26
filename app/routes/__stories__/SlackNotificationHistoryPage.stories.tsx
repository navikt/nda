import type { Meta, StoryObj } from '@storybook/react'
import {
  type SlackConfigChangeEntry,
  type SlackNotificationHistoryApp,
  type SlackNotificationHistoryEntry,
  SlackNotificationHistoryPage,
} from '~/components/SlackNotificationHistoryPage'

const app: SlackNotificationHistoryApp = {
  app_name: 'pensjon-pen',
  environment_name: 'prod-fss',
  team_slug: 'pensjondeployer',
  slack_notifications_enabled: true,
  slack_channel_id: 'C01234567',
  slack_deploy_notify_enabled: true,
  slack_deploy_channel_id: 'C07654321',
}

const approvalNotification: SlackNotificationHistoryEntry = {
  id: 1,
  notification_type: 'approval',
  deployment_id: 101,
  deployment_commit_sha: 'abc1234def5678901234567890abcdef1234567',
  sent_at: '2026-02-10T09:15:00Z',
  sent_by: 'Z990001',
  message_text: '⚠️ Deployment krever godkjenning: pensjon-pen (prod-fss)',
  update_count: 2,
  interaction_count: 1,
  updates: [
    { id: 1, created_at: '2026-02-10T09:15:00Z', action: 'sent', triggered_by: 'Z990001' },
    { id: 2, created_at: '2026-02-10T10:02:00Z', action: 'updated', triggered_by: 'system' },
  ],
  interactions: [
    {
      id: 1,
      created_at: '2026-02-10T09:45:00Z',
      action_id: 'approve_deployment',
      slack_user_id: 'U0ABCDEF1',
      slack_username: 'Glad Fjord',
    },
  ],
}

const deployNotification: SlackNotificationHistoryEntry = {
  id: 2,
  notification_type: 'deploy',
  deployment_id: 102,
  deployment_commit_sha: 'def4567abc8901234567890abcdef1234567890',
  sent_at: '2026-02-11T13:30:00Z',
  sent_by: null,
  message_text: '🚀 Ny deployment — pensjon-pen (prod-fss)',
  update_count: 1,
  interaction_count: 0,
  updates: [{ id: 3, created_at: '2026-02-11T13:30:00Z', action: 'sent', triggered_by: null }],
  interactions: [],
}

const disabledEvent: SlackConfigChangeEntry = {
  id: 1,
  setting_key: 'slack_deploy_notify_enabled',
  changed_by_nav_ident: 'Z990002',
  changed_by_name: 'Rask Elv',
  old_value: { enabled: true, channel_id: 'C0DEPLOY1' },
  new_value: { enabled: false, channel_id: 'C0DEPLOY1' },
  created_at: '2026-03-01T08:00:00Z',
}

const reenabledEvent: SlackConfigChangeEntry = {
  id: 2,
  setting_key: 'slack_deploy_notify_enabled',
  changed_by_nav_ident: 'Z990002',
  changed_by_name: 'Rask Elv',
  old_value: { enabled: false, channel_id: 'C0DEPLOY1' },
  new_value: { enabled: true, channel_id: 'C0DEPLOY1' },
  created_at: '2026-05-15T10:30:00Z',
}

const channelChangedEvent: SlackConfigChangeEntry = {
  id: 3,
  setting_key: 'slack_deploy_notify_enabled',
  changed_by_nav_ident: 'Z990002',
  changed_by_name: 'Rask Elv',
  old_value: { enabled: true, channel_id: 'C0DEPLOY1' },
  new_value: { enabled: true, channel_id: 'C0NEWCHAN' },
  created_at: '2026-06-01T09:00:00Z',
}

const meta: Meta<typeof SlackNotificationHistoryPage> = {
  title: 'Features/SlackNotificationHistoryPage',
  component: SlackNotificationHistoryPage,
}
export default meta
type Story = StoryObj<typeof SlackNotificationHistoryPage>

export const WithHistory: Story = {
  name: 'Med meldingshistorikk',
  args: {
    app,
    notifications: [deployNotification, approvalNotification],
  },
}

export const WithConfigChanges: Story = {
  name: 'Med meldingshistorikk og konfigurasjonsendringer',
  args: {
    app,
    notifications: [deployNotification, approvalNotification],
    configChanges: [channelChangedEvent, reenabledEvent, disabledEvent],
  },
}

export const Empty: Story = {
  name: 'Ingen meldinger sendt ennå',
  args: {
    app,
    notifications: [],
  },
}

export const NotificationsDisabled: Story = {
  name: 'Slack-varsler deaktivert',
  args: {
    app: { ...app, slack_notifications_enabled: false, slack_channel_id: null },
    notifications: [],
  },
}
