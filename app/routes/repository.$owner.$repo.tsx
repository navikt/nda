import { redirect, useLoaderData } from 'react-router'
import { RepositoryPage } from '~/components/RepositoryPage'
import { getAffectedAppsForRepositoryId, getRepositoryByOwnerRepo } from '~/db/repositories.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data ? `${data.repository.github_owner}/${data.repository.github_repo_name}` : 'Repository' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])

  const lookup = await getRepositoryByOwnerRepo(owner, repo)

  if (lookup.status === 'redirect') {
    const url = new URL(request.url)
    const redirectPath = `/repository/${encodeURIComponent(lookup.githubOwner)}/${encodeURIComponent(lookup.githubRepoName)}${url.search}`
    throw redirect(redirectPath, { status: 301 })
  }

  if (lookup.status === 'not_found') {
    throw new Response('Repository not found', { status: 404 })
  }

  const affectedApps = await getAffectedAppsForRepositoryId(lookup.repository.id)

  return {
    repository: lookup.repository,
    affectedApps,
  }
}

export default function RepositoryRoute() {
  const { repository, affectedApps } = useLoaderData<typeof loader>()

  return <RepositoryPage repository={repository} affectedApps={affectedApps} />
}
