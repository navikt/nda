import { searchDeployments } from '~/db/deployments.server'
import type { Route } from './+types/search'

export async function loader({ url }: Route.LoaderArgs) {
  const query = url.searchParams.get('q') || ''

  if (!query.trim()) {
    return Response.json({ results: [] })
  }

  const results = await searchDeployments(query, 10)
  return Response.json({ results })
}
