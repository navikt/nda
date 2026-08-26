import { saveCheckAnnotationsRawSnapshot } from '~/db/github-data.server'
import { getGitHubClient, getRepositoryId } from '~/lib/github'
import { captureApiVersionMetadata } from '~/lib/github/pr-snapshot'
import { logger } from '~/lib/logger.server'
import type { Route } from './+types/checks.annotations'

async function archiveCheckAnnotationsRawSnapshot(
  owner: string,
  repo: string,
  checkRunId: number,
  data: unknown,
  headers: Record<string, unknown> | null,
): Promise<void> {
  try {
    const githubRepoId = await getRepositoryId(owner, repo)
    if (githubRepoId === null) return
    const apiVersion = captureApiVersionMetadata(headers ?? {}, null)
    await saveCheckAnnotationsRawSnapshot(owner, repo, githubRepoId, checkRunId, data, apiVersion)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`⚠️ Failed to archive annotations for check run ${checkRunId} in ${owner}/${repo}:`, {
      error: message,
    })
  }
}

export async function loader({ url }: Route.LoaderArgs) {
  const owner = url.searchParams.get('owner')
  const repo = url.searchParams.get('repo')
  const checkRunId = url.searchParams.get('check_run_id')

  if (!owner || !repo || !checkRunId) {
    return Response.json({ error: 'Missing required parameters: owner, repo, check_run_id' }, { status: 400 })
  }

  const checkRunIdNum = Number.parseInt(checkRunId, 10)
  if (!Number.isFinite(checkRunIdNum) || checkRunIdNum <= 0) {
    return Response.json({ error: 'check_run_id must be a positive number' }, { status: 400 })
  }

  try {
    const client = getGitHubClient()
    let responseHeaders: Record<string, unknown> | null = null
    const rawAnnotations = await client.paginate(
      client.checks.listAnnotations,
      { owner, repo, check_run_id: checkRunIdNum, per_page: 100 },
      (response) => {
        responseHeaders ??= response.headers
        return response.data
      },
    )

    await archiveCheckAnnotationsRawSnapshot(owner, repo, checkRunIdNum, rawAnnotations, responseHeaders)

    const annotations = rawAnnotations.map((a) => ({
      path: a.path ?? null,
      start_line: a.start_line,
      end_line: a.end_line,
      start_column: a.start_column ?? null,
      end_column: a.end_column ?? null,
      annotation_level: a.annotation_level ?? 'notice',
      message: a.message ?? '',
      title: a.title ?? null,
      raw_details: a.raw_details ?? null,
    }))

    return Response.json({ annotations })
  } catch (error) {
    logger.warn(`Could not fetch annotations for check run ${checkRunId}: ${error}`)
    return Response.json({ error: 'Kunne ikke hente annotations.' }, { status: 500 })
  }
}
