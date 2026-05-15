import { LayersIcon, MagnifyingGlassIcon, PersonGroupIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Heading, Hide, HStack, Search, Show, Tag, VStack } from '@navikt/ds-react'
import { Form, Link } from 'react-router'
import {
  getDefaultSearchResultPresentation,
  type SearchResult,
  type SearchResultIcon,
  type SearchResultPresentation,
} from '~/lib/search-results'

function ResultIcon({ icon }: { icon: SearchResultIcon }) {
  if (icon === 'group') {
    return <LayersIcon style={{ fontSize: '1.25rem', color: 'var(--ax-text-neutral-subtle)' }} aria-hidden />
  }

  if (icon === 'dev-team') {
    return <PersonGroupIcon style={{ fontSize: '1.25rem', color: 'var(--ax-text-neutral-subtle)' }} aria-hidden />
  }

  return <MagnifyingGlassIcon style={{ fontSize: '1.25rem', color: 'var(--ax-text-neutral-subtle)' }} aria-hidden />
}

export function SearchResultsPage({
  query,
  results,
  getResultPresentation = getDefaultSearchResultPresentation,
}: {
  query: string
  results: SearchResult[]
  getResultPresentation?: (result: SearchResult) => SearchResultPresentation
}) {
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
          {results.map((result) => {
            const presentation = getResultPresentation(result)

            return (
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
                    <ResultIcon icon={presentation.icon} />
                    <VStack gap="space-4" style={{ flex: 1 }}>
                      <HStack gap="space-8" align="center">
                        <BodyShort weight="semibold">{result.title}</BodyShort>
                        <Tag size="xsmall" variant={presentation.variant}>
                          {presentation.label}
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
            )
          })}
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
