import { useLoaderData } from 'react-router'
import { RepositoryIdBackfillCoverage } from '~/components/RepositoryIdBackfillCoverage'
import {
  getWorkflowRunBackfillCoverageTeams,
  getWorkflowRunBackfillPreviewRepository,
  getWorkflowRunRepositoryBackfillCoverage,
  getWorkflowRunRepositoryBackfillPreview,
} from '~/db/workflow-run-repository-backfill-coverage.server'
import { requireAdmin } from '~/lib/auth.server'
import type { Route } from './+types/repository-id-backfill-coverage'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Repository-ID backfill – admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)
  const searchParams = new URL(request.url).searchParams
  const requestedRepositoryId = searchParams.get('repositoryId')

  if (requestedRepositoryId !== null) {
    const parsedRepositoryId = /^\d+$/.test(requestedRepositoryId) ? Number(requestedRepositoryId) : Number.NaN
    const validRepositoryId =
      Number.isSafeInteger(parsedRepositoryId) && parsedRepositoryId > 0 && parsedRepositoryId <= 2_147_483_647

    if (!validRepositoryId) {
      return {
        teams: [],
        selectedTeam: null,
        invalidTeam: false,
        repositories: [],
        totals: { legacy: 0, eligible: 0 },
        previewRepository: null,
        previewDeployments: [],
        invalidRepository: true,
        returnToTeam: searchParams.get('team'),
      }
    }

    const previewRepository = await getWorkflowRunBackfillPreviewRepository(parsedRepositoryId)
    if (!previewRepository) {
      return {
        teams: [],
        selectedTeam: null,
        invalidTeam: false,
        repositories: [],
        totals: { legacy: 0, eligible: 0 },
        previewRepository: null,
        previewDeployments: [],
        invalidRepository: true,
        returnToTeam: searchParams.get('team'),
      }
    }

    const previewDeployments = await getWorkflowRunRepositoryBackfillPreview(parsedRepositoryId)
    return {
      teams: [],
      selectedTeam: null,
      invalidTeam: false,
      repositories: [],
      totals: {
        legacy: previewDeployments.length,
        eligible: previewDeployments.filter((deployment) => deployment.classification === 'eligible').length,
      },
      previewRepository,
      previewDeployments,
      invalidRepository: false,
      returnToTeam: searchParams.get('team'),
    }
  }

  const teams = await getWorkflowRunBackfillCoverageTeams()
  const requestedTeam = searchParams.get('team')
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

  return {
    teams,
    selectedTeam,
    invalidTeam,
    repositories,
    totals,
    previewRepository: null,
    previewDeployments: [],
    invalidRepository: false,
    returnToTeam: null,
  }
}

export default function RepositoryIdBackfillCoveragePage() {
  const {
    teams,
    selectedTeam,
    invalidTeam,
    repositories,
    totals,
    previewRepository,
    previewDeployments,
    invalidRepository,
    returnToTeam,
  } = useLoaderData<typeof loader>()
  return (
    <RepositoryIdBackfillCoverage
      teams={teams}
      selectedTeam={selectedTeam}
      invalidTeam={invalidTeam}
      repositories={repositories}
      totals={totals}
      previewRepository={previewRepository}
      previewDeployments={previewDeployments}
      invalidRepository={invalidRepository}
      returnToTeam={returnToTeam}
    />
  )
}
