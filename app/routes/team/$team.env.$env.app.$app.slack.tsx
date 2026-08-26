import { redirect, useLoaderData } from 'react-router'
import { SlackNotificationHistoryPage } from '~/components/SlackNotificationHistoryPage'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import {
  getSlackInteractions,
  getSlackNotificationsByApp,
  getSlackNotificationUpdates,
} from '~/db/slack-notifications.server'
import { getUserIdentity } from '~/lib/auth.server'
import { requireTeamEnvAppParams } from '~/lib/route-params.server'
import type { Route } from './+types/$team.env.$env.app.$app.slack'

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

  const notifications = await getSlackNotificationsByApp(app.id, 100)

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
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Slack - ${data?.app?.app_name ?? 'App'} - NDA` }]
}

export default function AppSlackPage() {
  const { app, notifications } = useLoaderData<typeof loader>()

  return <SlackNotificationHistoryPage app={app} notifications={notifications} />
}
