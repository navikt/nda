import { useLoaderData } from 'react-router'
import { RepositoryPage } from '~/components/RepositoryPage'
import { getAffectedAppsForRepositoryId } from '~/db/repositories.server'
import { getUserIdentity } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import type { Route } from './+types/repository.$owner.$repo'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data ? `${data.repository.github_owner}/${data.repository.github_repo_name}` : 'Repository' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { owner, repo } = requireParams(params, ['owner', 'repo'])
  const url = new URL(request.url)
  const repository = await resolveRepositoryFromParams(owner, repo, url, '')

  const identity = await getUserIdentity(request)

  const { affectedApps, canAccessAdmin } = identity
    ? await resolveRepositoryAdminAccess(identity, repository.id).then(({ affectedApps, authorized }) => ({
        affectedApps,
        canAccessAdmin: authorized,
      }))
    : { affectedApps: await getAffectedAppsForRepositoryId(repository.id), canAccessAdmin: false }

  return {
    repository,
    affectedApps,
    canAccessAdmin,
  }
}

export default function RepositoryRoute() {
  const { repository, affectedApps, canAccessAdmin } = useLoaderData<typeof loader>()

  return <RepositoryPage repository={repository} affectedApps={affectedApps} canAccessAdmin={canAccessAdmin} />
}
