import { useLoaderData } from 'react-router'
import { RepositoryIdBackfillCoverage } from '~/components/RepositoryIdBackfillCoverage'
import {
  getWorkflowRunBackfillCoverageTeams,
  getWorkflowRunBackfillPreviewRepository,
  getWorkflowRunRepositoryBackfillCoverage,
  getWorkflowRunRepositoryBackfillPreview,
} from '~/db/workflow-run-repository-backfill-coverage.server'
import { requireAdmin } from '~/lib/auth.server'
import { getFormString } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { queueRepositoryIdBackfill, startRepositoryIdBackfillJob } from '~/lib/repository-id-backfill.server'
import type { Route } from './+types/repository-id-backfill-coverage'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Repository-ID backfill – admin' }]
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request)
  const formData = await request.formData()
  if (getFormString(formData, 'action') !== 'backfill_repository') {
    return { error: 'Ukjent handling' }
  }

  const repositoryIdValue = getFormString(formData, 'repository_id')
  const repositoryId = repositoryIdValue && /^\d+$/.test(repositoryIdValue) ? Number(repositoryIdValue) : Number.NaN
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0 || repositoryId > 2_147_483_647) {
    return { error: 'Ugyldig repository-ID' }
  }
  if (getFormString(formData, 'confirm_repository_scope') !== 'true') {
    return { error: 'Bekreft at backfillen gjelder alle team og apper for repositoryet' }
  }

  const repository = await getWorkflowRunBackfillPreviewRepository(repositoryId)
  if (!repository) {
    return { error: 'Fant ikke repositoryet' }
  }

  const queued = await queueRepositoryIdBackfill(repositoryId, admin.navIdent)
  if (!queued) {
    return { error: 'Fant ikke en aktiv jobb etter at en annen kjøring startet. Prøv igjen.' }
  }
  if (queued.started) {
    startRepositoryIdBackfillJob(queued.jobId, repositoryId)
    logger.info(`Started repository-ID backfill job ${queued.jobId} for repository ${repositoryId}`)
  }

  return { backfillJobStarted: queued.jobId }
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
