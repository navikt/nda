import { DeploymentDetailPage } from '~/components/DeploymentDetailPage'
import { DeploymentRepositoryPage } from '~/components/DeploymentRepositoryPage'
import { getDeploymentRepositoryView } from '~/db/deployment-repository-view.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getUserIdentity } from '~/lib/auth.server'
import { getDeploymentView } from '~/lib/deployment-view'
import { requireParams } from '~/lib/route-params.server'
import { action as deploymentAction, loader as deploymentLoader } from '../deployments/$id'
import type { Route } from './+types/$team.env.$env.app.$app.deployments.$deploymentId'

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const { team, env, app: appName, deploymentId } = requireParams(params, ['team', 'env', 'app', 'deploymentId'])
  const id = Number.parseInt(deploymentId, 10)
  if (
    !/^\d+$/.test(deploymentId) ||
    !Number.isFinite(id) ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    id > 2_147_483_647
  ) {
    throw new Response('Invalid deployment ID', { status: 400 })
  }

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  if (getDeploymentView(url.searchParams.get('view')) === 'repository') {
    const user = await getUserIdentity(request)
    const repositoryView = await getDeploymentRepositoryView(id, user, app.id)
    if (!repositoryView) throw new Response('Deployment not found', { status: 404 })
    return {
      view: 'repository' as const,
      repositoryView,
      deployment: repositoryView.deployment,
      app,
    }
  }

  const result = await deploymentLoader({
    params: { id: deploymentId },
    request,
    url,
  } as Parameters<typeof deploymentLoader>[0])

  if (result instanceof Response) {
    return result
  }
  if (result.deployment.monitored_app_id !== app.id) {
    throw new Response('Deployment not found', { status: 404 })
  }

  return {
    ...result,
    view: 'application' as const,
    app,
    appContext: true,
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  const deployment = data?.deployment
  return [{ title: deployment ? `Deployment #${deployment.id} - NDA` : 'Deployment' }]
}

export async function action({ params, request, url }: Route.ActionArgs) {
  return deploymentAction({
    params: { id: params.deploymentId },
    request,
    url,
  } as Parameters<typeof deploymentAction>[0])
}

export default function DeploymentView({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.view === 'repository') {
    return <DeploymentRepositoryPage data={loaderData.repositoryView} actionData={actionData} />
  }
  return <DeploymentDetailPage loaderData={loaderData} actionData={actionData} />
}
