import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { requireParams } from '~/lib/route-params.server'
import { default as DeploymentDetail, action as deploymentAction, loader as deploymentLoader } from '../deployments/$id'
import type { Route } from './+types/$team.env.$env.app.$app.deployments.$deploymentId'

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const { team, env, app: appName, deploymentId } = requireParams(params, ['team', 'env', 'app', 'deploymentId'])

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const result = await deploymentLoader({
    params: { id: deploymentId },
    request,
    url,
  } as Parameters<typeof deploymentLoader>[0])

  if (result instanceof Response) {
    return result
  }

  return {
    ...result,
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

export default DeploymentDetail
