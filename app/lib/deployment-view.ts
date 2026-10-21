export type DeploymentView = 'application' | 'repository'

export function getDeploymentView(value: string | null): DeploymentView {
  return value === 'repository' ? 'repository' : 'application'
}

export function deploymentViewUrl(pathname: string, searchParams: URLSearchParams, view: DeploymentView): string {
  const params = new URLSearchParams(searchParams)
  params.set('view', view)
  return `${pathname}?${params}`
}

export function deploymentListUrl(pathname: string, searchParams: URLSearchParams): string {
  const params = new URLSearchParams(searchParams)
  params.set('view', getDeploymentView(params.get('listView')))
  params.delete('listView')
  return `${pathname}?${params}`
}
