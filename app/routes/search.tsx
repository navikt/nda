import { useLoaderData } from 'react-router'
import { SearchResultsPage } from '~/components/SearchResultsPage'
import { type SearchResult, searchDeployments } from '~/db/deployments.server'
import type { Route } from './+types/search'

export function meta({ data }: { data: { query: string } }) {
  return [{ title: data?.query ? `Søk: ${data.query} - NDA` : 'Søk - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q') || ''

  const results: SearchResult[] = query.trim() ? await searchDeployments(query, 50) : []

  return { query, results }
}

export default function SearchPage() {
  const { query, results } = useLoaderData<typeof loader>()

  return <SearchResultsPage query={query} results={results} />
}
