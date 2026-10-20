export type DeploymentView = 'application' | 'repository'

export function getDeploymentView(value: string | null): DeploymentView {
  return value === 'repository' ? 'repository' : 'application'
}

export function deploymentViewUrl(pathname: string, searchParams: URLSearchParams, view: DeploymentView): string {
  const params = new URLSearchParams(searchParams)
  params.set('view', view)
  return `${pathname}?${params}`
}
