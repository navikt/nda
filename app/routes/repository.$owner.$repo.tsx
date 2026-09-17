import { redirect, useLoaderData } from 'react-router'
import { RepositoryPage } from '~/components/RepositoryPage'
import {
  getAffectedAppsForRepositoryId,
  getRepositoryById,
  getRepositoryByOwnerRepo,
  isCurrentOrHistoricalNameForRepositoryId,
} from '~/db/repositories.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data ? `${data.repository.github_owner}/${data.repository.github_repo_name}` : 'Repository' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const url = new URL(request.url)
  const repositoryIdParam = url.searchParams.get('repositoryId')
  const requestedRepositoryId = repositoryIdParam !== null ? Number(repositoryIdParam) : null

  const repository = await (async () => {
    if (
      requestedRepositoryId !== null &&
      Number.isInteger(requestedRepositoryId) &&
      requestedRepositoryId > 0 &&
      requestedRepositoryId <= 2_147_483_647
    ) {
      const byId = await getRepositoryById(requestedRepositoryId)
      if (byId && (await isCurrentOrHistoricalNameForRepositoryId(byId.id, owner, repo))) {
        if (byId.github_owner !== owner || byId.github_repo_name !== repo) {
          const redirectPath = `/repository/${encodeURIComponent(byId.github_owner)}/${encodeURIComponent(byId.github_repo_name)}?repositoryId=${byId.id}`
          throw redirect(redirectPath, { status: 301 })
        }
        return byId
      }
    }

    const lookup = await getRepositoryByOwnerRepo(owner, repo)

    if (lookup.status === 'redirect') {
      const redirectPath = `/repository/${encodeURIComponent(lookup.githubOwner)}/${encodeURIComponent(lookup.githubRepoName)}${url.search}`
      throw redirect(redirectPath, { status: 301 })
    }

    if (lookup.status === 'not_found') {
      throw new Response('Repository not found', { status: 404 })
    }

    return lookup.repository
  })()

  const affectedApps = await getAffectedAppsForRepositoryId(repository.id)

  return {
    repository,
    affectedApps,
  }
}

export default function RepositoryRoute() {
  const { repository, affectedApps } = useLoaderData<typeof loader>()

  return <RepositoryPage repository={repository} affectedApps={affectedApps} />
}
