import { DeploymentDetailPage } from '~/components/DeploymentDetailPage'
import type { Route } from './+types/$id'

export { action } from './$id.actions.server'
export { loader } from './$id.loader.server'

export function meta({ loaderData: data }: Route.MetaArgs) {
  const deployment = data?.deployment
  return [{ title: deployment ? `Deployment #${deployment.id} - NDA` : 'Deployment' }]
}

export default function DeploymentDetailRoute({ loaderData, actionData }: Route.ComponentProps) {
  return <DeploymentDetailPage loaderData={loaderData} actionData={actionData} />
}
