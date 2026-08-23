import { useLoaderData } from 'react-router'
import { SearchPage } from '~/components/SearchPage'
import { type SearchResult, searchDeployments } from '~/db/deployments.server'
import type { Route } from './+types/search'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.query ? `Søk: ${data.query} - NDA` : 'Søk - NDA' }]
}

export async function loader({ url }: Route.LoaderArgs) {
  const query = url.searchParams.get('q') || ''

  let results: SearchResult[] = []
  if (query.trim()) {
    results = await searchDeployments(query, 50)
  }

  return { query, results }
}

export default function SearchRoute() {
  const loaderData = useLoaderData<typeof loader>()

  return <SearchPage {...loaderData} />
}
