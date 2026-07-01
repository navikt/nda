import { getGitHubClient } from '~/lib/github'
import { logger } from '~/lib/logger.server'
import type { Route } from './+types/checks.annotations'

export async function loader({ url }: Route.LoaderArgs) {
  const owner = url.searchParams.get('owner')
  const repo = url.searchParams.get('repo')
  const checkRunId = url.searchParams.get('check_run_id')

  if (!owner || !repo || !checkRunId) {
    return Response.json({ error: 'Missing required parameters: owner, repo, check_run_id' }, { status: 400 })
  }

  const checkRunIdNum = Number.parseInt(checkRunId, 10)
  if (Number.isNaN(checkRunIdNum)) {
    return Response.json({ error: 'check_run_id must be a number' }, { status: 400 })
  }

  try {
    const client = getGitHubClient()
    const response = await client.checks.listAnnotations({
      owner,
      repo,
      check_run_id: checkRunIdNum,
    })

    const annotations = response.data.map((a) => ({
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
