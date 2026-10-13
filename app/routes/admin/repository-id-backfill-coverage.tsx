import { useLoaderData } from 'react-router'
import { RepositoryIdBackfillCoverage } from '~/components/RepositoryIdBackfillCoverage'
import {
  getWorkflowRunBackfillCoverageTeams,
  getWorkflowRunRepositoryBackfillCoverage,
} from '~/db/workflow-run-repository-backfill-coverage.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/repository-id-backfill-coverage'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Repository-ID backfill – admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const teams = await getWorkflowRunBackfillCoverageTeams()
  const requestedTeam = new URL(request.url).searchParams.get('team')
  const selectedTeam = requestedTeam && teams.includes(requestedTeam) ? requestedTeam : null
  const invalidTeam = Boolean(requestedTeam && !selectedTeam)
  const repositories = selectedTeam ? await getWorkflowRunRepositoryBackfillCoverage(selectedTeam) : []
  const totals = repositories.reduce(
    (result, repository) => ({
      legacy: result.legacy + repository.totalLegacyDeployments,
      eligible: result.eligible + repository.eligible,
    }),
    { legacy: 0, eligible: 0 },
  )

  return { teams, selectedTeam, invalidTeam, repositories, totals }
}

export default function RepositoryIdBackfillCoveragePage() {
  const { teams, selectedTeam, invalidTeam, repositories, totals } = useLoaderData<typeof loader>()
  return (
    <RepositoryIdBackfillCoverage
      teams={teams}
      selectedTeam={selectedTeam}
      invalidTeam={invalidTeam}
      repositories={repositories}
      totals={totals}
    />
  )
}
