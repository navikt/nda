import { useLoaderData } from 'react-router'
import { RepositoryPage } from '~/components/RepositoryPage'
import { getRepositoryDeploymentStats } from '~/db/deployments.server'
import {
  getAffectedAppsForRepositoryId,
  getAllAppsLinkedToRepositoryId,
  getEffectiveSettingsForApps,
} from '~/db/repositories.server'
import { getUserIdentity } from '~/lib/auth.server'
import { resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import { resolveRepositoryFromParams } from '~/lib/repository-resolution.server'
import { requireParams } from '~/lib/route-params.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
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

  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod
  const range = getDateRangeForPeriod(period)

  const linkedApps = await getAllAppsLinkedToRepositoryId(repository.id)
  const effectiveSettingsByApp = await getEffectiveSettingsForApps(linkedApps.map((a) => a.id))
  const deploymentStats = await getRepositoryDeploymentStats(
    linkedApps.map((a) => ({ id: a.id, audit_start_year: effectiveSettingsByApp.get(a.id)?.auditStartYear ?? null })),
    range?.startDate,
    range?.endDate,
  )

  return {
    repository,
    affectedApps,
    canAccessAdmin,
    deploymentStats,
    period,
  }
}

export default function RepositoryRoute() {
  const { repository, affectedApps, canAccessAdmin, deploymentStats, period } = useLoaderData<typeof loader>()

  return (
    <RepositoryPage
      repository={repository}
      affectedApps={affectedApps}
      canAccessAdmin={canAccessAdmin}
      deploymentStats={deploymentStats}
      period={period}
    />
  )
}
