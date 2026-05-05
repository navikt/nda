import { Alert, Box, Detail, Heading, HGrid, LinkCard, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Link } from 'react-router'

interface TeamCoverage {
  total: number
  with_four_eyes: number
  four_eyes_percentage: number
  with_origin: number
  origin_percentage: number
  non_member_deployments: number
}

function CoverageCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <LinkCard>
      <LinkCard.Title as="span">
        <LinkCard.Anchor asChild>
          <Link to="#">{label}</Link>
        </LinkCard.Anchor>
      </LinkCard.Title>
      <LinkCard.Description>
        <VStack gap="space-4">
          <Heading level="3" size="medium" aria-label={`${label}: ${value}`}>
            {value}
          </Heading>
          {sub && <Detail textColor="subtle">{sub}</Detail>}
        </VStack>
      </LinkCard.Description>
    </LinkCard>
  )
}

function TeamCoverageCards({
  coverage,
  hasMappedMembers,
  unmappedMemberCount,
  totalMembers,
}: {
  coverage: TeamCoverage
  hasMappedMembers: boolean
  unmappedMemberCount: number
  totalMembers: number
}) {
  if (totalMembers === 0 && coverage.total === 0) {
    return (
      <Alert variant="info">
        Ingen medlemmer er registrert for dette teamet enda. Statistikk på team-medlemmenes deploys vises når medlemmer
        er lagt til.
      </Alert>
    )
  }

  return (
    <VStack gap="space-8">
      {totalMembers === 0 && coverage.total > 0 && (
        <Alert variant="info" size="small">
          Ingen medlemmer er registrert — kun leveranser koblet til måltavlen vises.
        </Alert>
      )}
      {!hasMappedMembers && totalMembers > 0 && coverage.total > 0 && (
        <Alert variant="warning" size="small">
          Ingen av de {totalMembers} medlemmene har et GitHub-brukernavn registrert — kun leveranser koblet til
          måltavlen vises.
        </Alert>
      )}
      {!hasMappedMembers && totalMembers > 0 && coverage.total === 0 && (
        <Alert variant="warning">
          Ingen av de {totalMembers} medlemmene har et GitHub-brukernavn registrert. Statistikk vises når
          brukerkoblinger er på plass.
        </Alert>
      )}
      {hasMappedMembers && unmappedMemberCount > 0 && (
        <Alert variant="warning" size="small">
          {unmappedMemberCount} av {totalMembers} medlemmer mangler GitHub-brukernavn — statistikken kan være
          ufullstendig.
        </Alert>
      )}
      <HGrid gap="space-12" columns={{ xs: 1, sm: 2, md: 4 }}>
        <CoverageCard label="Leveranser i år" value={coverage.total.toString()} />
        <CoverageCard
          label="4-øyne-dekning"
          value={`${coverage.four_eyes_percentage}%`}
          sub={`${coverage.with_four_eyes} av ${coverage.total}`}
        />
        <CoverageCard
          label="Endringsopphav"
          value={`${coverage.origin_percentage}%`}
          sub={`${coverage.with_origin} av ${coverage.total}`}
        />
        <CoverageCard label="Fra andre" value={coverage.non_member_deployments.toString()} sub="Koblet via måltavle" />
      </HGrid>
      <Detail textColor="subtle">
        Inkluderer leveranser koblet til teamets måltavle og ukoblede leveranser fra teammedlemmer (år til dato).
      </Detail>
    </VStack>
  )
}

const meta: Meta<typeof TeamCoverageCards> = {
  title: 'Pages/DevTeamCoverage',
  component: TeamCoverageCards,
  decorators: [
    (Story) => (
      <Box paddingInline="space-24" paddingBlock="space-24" style={{ maxWidth: '900px' }}>
        <Story />
      </Box>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof TeamCoverageCards>

export const FullCoverage: Story = {
  args: {
    coverage: {
      total: 142,
      with_four_eyes: 142,
      four_eyes_percentage: 100,
      with_origin: 142,
      origin_percentage: 100,
      non_member_deployments: 0,
    },
    hasMappedMembers: true,
    unmappedMemberCount: 0,
    totalMembers: 5,
  },
}

export const WithNonMemberDeployments: Story = {
  args: {
    coverage: {
      total: 89,
      with_four_eyes: 82,
      four_eyes_percentage: 92,
      with_origin: 73,
      origin_percentage: 82,
      non_member_deployments: 12,
    },
    hasMappedMembers: true,
    unmappedMemberCount: 0,
    totalMembers: 4,
  },
}

export const PartialCoverage: Story = {
  args: {
    coverage: {
      total: 56,
      with_four_eyes: 43,
      four_eyes_percentage: 76,
      with_origin: 31,
      origin_percentage: 55,
      non_member_deployments: 5,
    },
    hasMappedMembers: true,
    unmappedMemberCount: 1,
    totalMembers: 3,
  },
}

export const NoMembers: Story = {
  args: {
    coverage: {
      total: 0,
      with_four_eyes: 0,
      four_eyes_percentage: 0,
      with_origin: 0,
      origin_percentage: 0,
      non_member_deployments: 0,
    },
    hasMappedMembers: false,
    unmappedMemberCount: 0,
    totalMembers: 0,
  },
}

export const NoMappedGitHub: Story = {
  args: {
    coverage: {
      total: 0,
      with_four_eyes: 0,
      four_eyes_percentage: 0,
      with_origin: 0,
      origin_percentage: 0,
      non_member_deployments: 0,
    },
    hasMappedMembers: false,
    unmappedMemberCount: 3,
    totalMembers: 3,
  },
}

export const NoMappedGitHubWithBoardDeployments: Story = {
  args: {
    coverage: {
      total: 15,
      with_four_eyes: 12,
      four_eyes_percentage: 80,
      with_origin: 15,
      origin_percentage: 100,
      non_member_deployments: 15,
    },
    hasMappedMembers: false,
    unmappedMemberCount: 3,
    totalMembers: 3,
  },
}
