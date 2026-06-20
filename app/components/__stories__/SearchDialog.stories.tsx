import { BodyShort, Box, Detail, HStack, Tag, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta = {
  title: 'Components/SearchDialog',
}

export default meta

type Story = StoryObj

function SearchResultItem({
  type,
  title,
  subtitle,
  selected,
}: {
  type: 'deployment' | 'user' | 'team' | 'dev_team' | 'app'
  title: string
  subtitle?: string
  selected?: boolean
}) {
  const variantMap: Record<typeof type, string> = {
    deployment: 'info',
    team: 'success',
    app: 'warning',
    dev_team: 'moderate',
    user: 'neutral',
  }
  const labelMap: Record<typeof type, string> = {
    deployment: 'Leveranse',
    team: 'Nais-team',
    app: 'Applikasjon',
    dev_team: 'Utviklerteam',
    user: 'Bruker',
  }

  return (
    <Box
      padding="space-12"
      background={selected ? 'neutral-moderate' : 'default'}
      borderRadius="4"
      style={{ cursor: 'pointer' }}
    >
      <HStack gap="space-12" align="center">
        <VStack gap="space-2" style={{ flex: 1 }}>
          <HStack gap="space-8" align="center">
            <BodyShort size="small" weight="semibold">
              {title}
            </BodyShort>
            <Tag variant={variantMap[type] as 'info'} size="xsmall">
              {labelMap[type]}
            </Tag>
          </HStack>
          {subtitle && <Detail textColor="subtle">{subtitle}</Detail>}
        </VStack>
      </HStack>
    </Box>
  )
}

export const SearchResults: Story = {
  name: 'Søkeresultater',
  render: () => (
    <Box
      padding="space-16"
      background="raised"
      borderRadius="8"
      borderColor="neutral-subtle"
      borderWidth="1"
      style={{ maxWidth: '500px' }}
    >
      <VStack gap="space-8">
        <Detail textColor="subtle">Søkeresultater for "pensjon"</Detail>
        <VStack gap="space-4">
          <SearchResultItem type="deployment" title="Deployment #123" subtitle="pensjon-pen • abc1234" selected />
          <SearchResultItem type="deployment" title="Deployment #122" subtitle="pensjon-pen • def5678" />
          <SearchResultItem type="dev_team" title="Pensjon Opptjening" subtitle="Utviklerteam · 14 apper" />
          <SearchResultItem type="team" title="pensjonopptjening" subtitle="14 applikasjoner" />
          <SearchResultItem type="app" title="pensjon-pen" subtitle="pensjonopptjening" />
          <SearchResultItem type="user" title="Ola Nordmann" subtitle="olanord • 42 deployment(s)" />
        </VStack>
      </VStack>
    </Box>
  ),
}

export const EmptyState: Story = {
  name: 'Ingen resultater',
  render: () => (
    <Box
      padding="space-16"
      background="raised"
      borderRadius="8"
      borderColor="neutral-subtle"
      borderWidth="1"
      style={{ maxWidth: '500px' }}
    >
      <VStack gap="space-8">
        <Detail textColor="subtle">Søkeresultater for "xyz123"</Detail>
        <BodyShort textColor="subtle">Ingen resultater funnet</BodyShort>
      </VStack>
    </Box>
  ),
}

export const LoadingState: Story = {
  name: 'Laster',
  render: () => (
    <Box
      padding="space-16"
      background="raised"
      borderRadius="8"
      borderColor="neutral-subtle"
      borderWidth="1"
      style={{ maxWidth: '500px' }}
    >
      <VStack gap="space-8">
        <Detail textColor="subtle">Søker...</Detail>
        <HStack justify="center" padding="space-16">
          <div
            style={{
              width: '24px',
              height: '24px',
              border: '2px solid var(--ax-border-neutral)',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        </HStack>
      </VStack>
    </Box>
  ),
}

export const KeyboardShortcut: Story = {
  name: 'Tastatursnarvei',
  render: () => (
    <Box padding="space-24">
      <VStack gap="space-16">
        <BodyShort>Åpne søkedialog med:</BodyShort>
        <HStack gap="space-8">
          <Box
            as="kbd"
            paddingInline="space-8"
            paddingBlock="space-4"
            background="neutral-moderate"
            borderRadius="4"
            style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
          >
            ⌘
          </Box>
          <BodyShort>+</BodyShort>
          <Box
            as="kbd"
            paddingInline="space-8"
            paddingBlock="space-4"
            background="neutral-moderate"
            borderRadius="4"
            style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
          >
            K
          </Box>
        </HStack>
        <Detail textColor="subtle">Eller Ctrl+K på Windows/Linux</Detail>
      </VStack>
    </Box>
  ),
}
