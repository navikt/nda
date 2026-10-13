import { useLoaderData } from 'react-router'
import { RepositoryIdBackfillCoverage } from '~/components/RepositoryIdBackfillCoverage'
import { getWorkflowRunRepositoryBackfillCoverage } from '~/db/workflow-run-repository-backfill-coverage.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/repository-id-backfill-coverage'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Repository-ID backfill – admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const repositories = await getWorkflowRunRepositoryBackfillCoverage()
  const totals = repositories.reduce(
    (result, repository) => ({
      legacy: result.legacy + repository.totalLegacyDeployments,
      eligible: result.eligible + repository.eligible,
    }),
    { legacy: 0, eligible: 0 },
  )

  return { repositories, totals }
}

export default function RepositoryIdBackfillCoveragePage() {
  const { repositories, totals } = useLoaderData<typeof loader>()
  return <RepositoryIdBackfillCoverage repositories={repositories} totals={totals} />
}
