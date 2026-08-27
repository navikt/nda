import { redirect, useLoaderData } from 'react-router'
import { SlackNotificationHistoryPage } from '~/components/SlackNotificationHistoryPage'
import { getAppConfigAuditLog } from '~/db/app-settings.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import {
  getSlackInteractions,
  getSlackNotificationsByApp,
  getSlackNotificationUpdates,
} from '~/db/slack-notifications.server'
import { getUserIdentity } from '~/lib/auth.server'
import { requireTeamEnvAppParams } from '~/lib/route-params.server'
import { SLACK_CONFIG_SETTING_KEYS, type SlackConfigSettingKey } from '~/lib/slack/config-setting-keys'
import type { Route } from './+types/$team.env.$env.app.$app.slack'

function isSlackConfigSettingKey(settingKey: string): settingKey is SlackConfigSettingKey {
  return (SLACK_CONFIG_SETTING_KEYS as readonly string[]).includes(settingKey)
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { team, env, app: appName } = requireTeamEnvAppParams(params)

  const identity = await getUserIdentity(request)
  if (identity?.role !== 'admin') {
    return redirect(`/team/${team}/env/${env}/app/${appName}`)
  }

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const [notifications, rawConfigChanges] = await Promise.all([
    getSlackNotificationsByApp(app.id, 100),
    getAppConfigAuditLog(app.id, { settingKey: SLACK_CONFIG_SETTING_KEYS, limit: 100 }),
  ])

  const configChanges = rawConfigChanges
    .filter((change) => isSlackConfigSettingKey(change.setting_key))
    .map((change) => ({
      id: change.id,
      setting_key: change.setting_key as SlackConfigSettingKey,
      changed_by_nav_ident: change.changed_by_nav_ident,
      changed_by_name: change.changed_by_name,
      old_value: change.old_value as { enabled?: boolean; channel_id?: string | null } | null,
      new_value: change.new_value as { enabled?: boolean; channel_id?: string | null },
      created_at: change.created_at,
    }))

  const notificationsWithDetails = await Promise.all(
    notifications.map(async (notification) => {
      const [updates, interactions] = await Promise.all([
        getSlackNotificationUpdates(notification.id),
        getSlackInteractions(notification.id),
      ])
      return {
        ...notification,
        updates,
        interactions,
      }
    }),
  )

  return {
    app,
    notifications: notificationsWithDetails,
    configChanges,
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Slack - ${data?.app?.app_name ?? 'App'} - NDA` }]
}

export default function AppSlackPage() {
  const { app, notifications, configChanges } = useLoaderData<typeof loader>()

  return <SlackNotificationHistoryPage app={app} notifications={notifications} configChanges={configChanges} />
}
