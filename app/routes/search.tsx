import { LayersIcon, MagnifyingGlassIcon, PersonGroupIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Heading, Hide, HStack, Search, Show, Tag, VStack } from '@navikt/ds-react'
import { Form, Link, useLoaderData } from 'react-router'
import { type SearchResult, searchDeployments } from '~/db/deployments.server'
import type { Route } from './+types/search'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.query ? `Søk: ${data.query} - NDA` : 'Søk - NDA' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q') || ''

  let results: SearchResult[] = []
  if (query.trim()) {
    results = await searchDeployments(query, 50)
  }

  return { query, results }
}

export default function SearchPage() {
  const { query, results } = useLoaderData<typeof loader>()

  return (
    <VStack gap="space-24">
      <VStack gap="space-8">
        <Heading level="1" size="large">
          Søk
        </Heading>
        <Hide above="md">
          <BodyShort>Søk på navn, NAV-ident, e-post, brukernavn, SHA eller ID</BodyShort>
        </Hide>
        <Show above="md">
          <BodyShort>
            {!query
              ? 'Bruk søkefeltet i header for å søke'
              : results.length === 0
                ? `Ingen resultater for "${query}"`
                : `${results.length} resultat${results.length === 1 ? '' : 'er'} for "${query}"`}
          </BodyShort>
        </Show>
      </VStack>

      {/* Mobile: Show search input */}
      <Hide above="md">
        <Box background="sunken" padding="space-16" borderRadius="8">
          <Form method="get" action="/search">
            <Search
              label="Søk"
              hideLabel
              variant="primary"
              placeholder="Navn, NAV-ident, e-post, SHA..."
              name="q"
              defaultValue={query}
            />
          </Form>
        </Box>
        {query && (
          <BodyShort>
            {results.length === 0
              ? `Ingen resultater for "${query}"`
              : `${results.length} resultat${results.length === 1 ? '' : 'er'}`}
          </BodyShort>
        )}
      </Hide>

      {results.length > 0 && (
        <VStack gap="space-8">
          {results.map((result) => (
            <Link
              key={`${result.type}-${result.id || result.title}`}
              to={result.url}
              style={{ textDecoration: 'none' }}
            >
              <Box
                background="default"
                padding="space-16"
                borderRadius="8"
                borderWidth="1"
                borderColor="neutral-subtle"
                style={{ cursor: 'pointer' }}
                className="search-result-item"
              >
                <HStack gap="space-12" align="center">
                  {result.type === 'group' ? (
                    <LayersIcon style={{ fontSize: '1.25rem', color: 'var(--ax-text-neutral-subtle)' }} aria-hidden />
                  ) : result.type === 'dev_team' ? (
                    <PersonGroupIcon
                      style={{ fontSize: '1.25rem', color: 'var(--ax-text-neutral-subtle)' }}
                      aria-hidden
                    />
                  ) : (
                    <MagnifyingGlassIcon
                      style={{ fontSize: '1.25rem', color: 'var(--ax-text-neutral-subtle)' }}
                      aria-hidden
                    />
                  )}
                  <VStack gap="space-4" style={{ flex: 1 }}>
                    <HStack gap="space-8" align="center">
                      <BodyShort weight="semibold">{result.title}</BodyShort>
                      <Tag
                        size="xsmall"
                        variant={
                          result.type === 'deployment'
                            ? 'info'
                            : result.type === 'group' || result.type === 'dev_team'
                              ? 'moderate'
                              : 'neutral'
                        }
                      >
                        {result.type === 'deployment'
                          ? 'Deployment'
                          : result.type === 'group'
                            ? 'Gruppe'
                            : result.type === 'dev_team'
                              ? 'Utviklerteam'
                              : result.type === 'team'
                                ? 'Nais-team'
                                : result.type === 'app'
                                  ? 'App'
                                  : 'Bruker'}
                      </Tag>
                    </HStack>
                    {result.subtitle && (
                      <BodyShort size="small" style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {result.subtitle}
                      </BodyShort>
                    )}
                  </VStack>
                </HStack>
              </Box>
            </Link>
          ))}
        </VStack>
      )}

      <style>{`
        .search-result-item:hover {
          background: var(--ax-bg-neutral-moderate) !important;
        }
      `}</style>
    </VStack>
  )
}
