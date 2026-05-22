import { MagnifyingGlassIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Heading, Hide, HStack, Search, Show, Tag, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Form, Link } from 'react-router'
import { mockSearchResults } from './mock-data'

type SearchResult = {
  id?: number
  type: 'deployment' | 'user'
  title: string
  subtitle?: string
  url: string
}

function SearchPage({ query, results }: { query: string; results: SearchResult[] }) {
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
              >
                <HStack gap="space-12" align="center">
                  <MagnifyingGlassIcon
                    style={{ fontSize: '1.25rem', color: 'var(--ax-text-neutral-subtle)' }}
                    aria-hidden
                  />
                  <VStack gap="space-4" style={{ flex: 1 }}>
                    <HStack gap="space-8" align="center">
                      <BodyShort weight="semibold">{result.title}</BodyShort>
                      <Tag size="xsmall" variant={result.type === 'deployment' ? 'info' : 'neutral'}>
                        {result.type === 'deployment' ? 'Deployment' : 'Bruker'}
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
    </VStack>
  )
}

const meta: Meta<typeof SearchPage> = {
  title: 'Pages/Search',
  component: SearchPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof SearchPage>

export const Empty: Story = {
  name: 'Tomt søk',
  args: {
    query: '',
    results: [],
  },
}

export const WithResults: Story = {
  name: 'Med resultater',
  args: {
    query: 'john',
    results: mockSearchResults,
  },
}

export const NoResults: Story = {
  name: 'Ingen treff',
  args: {
    query: 'xyz123',
    results: [],
  },
}

export const ManyResults: Story = {
  name: 'Mange resultater',
  args: {
    query: 'pensjon',
    results: [
      ...mockSearchResults,
      {
        id: 3,
        type: 'deployment',
        title: 'def456ghi789',
        subtitle: 'pensjon-selvbetjening (prod-fss) - Stille Skog',
        url: '/team/pensjondeployer/env/prod-fss/app/pensjon-selvbetjening/deployments/3',
      },
      {
        id: 4,
        type: 'deployment',
        title: 'ghi789jkl012',
        subtitle: 'pensjon-opptjening (prod-gcp) - Bob Smith',
        url: '/team/pensjondeployer/env/prod-gcp/app/pensjon-opptjening/deployments/4',
      },
      {
        type: 'user',
        title: 'jane-doe',
        subtitle: 'Stille Skog (Z990009)',
        url: '/users/jane-doe',
      },
    ],
  },
}
