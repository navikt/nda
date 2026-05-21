import { requireUser } from '~/lib/auth.server'
import { canSearchUsers } from '~/lib/authorization.server'
import { logger } from '~/lib/logger.server'
import { searchGraphUsers } from '~/lib/microsoft-graph.server'
import type { Route } from './+types/users.search'

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)

  if (!(await canSearchUsers(user))) {
    return Response.json(
      { results: [], error: 'Ingen tilgang' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const url = new URL(request.url)
  const query = url.searchParams.get('q') || ''

  if (query.trim().length < 2) {
    return Response.json({ results: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const results = await searchGraphUsers(query)
    return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error('User search failed:', error)
    return Response.json(
      { results: [], error: 'Søket feilet' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
