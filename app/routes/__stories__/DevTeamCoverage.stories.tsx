import { Box } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { type TeamCoverage, TeamCoverageCards } from '~/components/DevTeamCoverageCards'

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

const emptyCoverage: TeamCoverage = {
  total: 0,
  with_four_eyes: 0,
  four_eyes_percentage: 0,
  with_origin: 0,
  origin_percentage: 0,
  non_member_deployments: 0,
}

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
    deploymentsPath: '#',
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
    deploymentsPath: '#',
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
    deploymentsPath: '#',
  },
}

export const NoMembers: Story = {
  args: {
    coverage: emptyCoverage,
    hasMappedMembers: false,
    unmappedMemberCount: 0,
    totalMembers: 0,
    deploymentsPath: '#',
  },
}

export const NoMappedGitHub: Story = {
  args: {
    coverage: emptyCoverage,
    hasMappedMembers: false,
    unmappedMemberCount: 3,
    totalMembers: 3,
    deploymentsPath: '#',
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
    deploymentsPath: '#',
  },
}
