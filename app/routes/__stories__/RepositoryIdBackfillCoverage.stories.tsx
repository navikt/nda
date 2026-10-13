import type { Meta, StoryObj } from '@storybook/react'
import { RepositoryIdBackfillCoverage } from '~/components/RepositoryIdBackfillCoverage'

const meta: Meta<typeof RepositoryIdBackfillCoverage> = {
  title: 'Pages/RepositoryIdBackfillCoverage',
  component: RepositoryIdBackfillCoverage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof RepositoryIdBackfillCoverage>

export const Default: Story = {
  args: {
    teams: ['pensjondeployer', 'team-a'],
    selectedTeam: 'pensjondeployer',
    invalidTeam: false,
    repositories: [
      {
        repositoryId: 216,
        githubOwner: 'navikt',
        githubRepoName: 'pensjon-alde',
        totalLegacyDeployments: 12,
        eligible: 5,
        noTriggerUrl: 1,
        invalidTriggerUrl: 1,
        triggerUrlMismatch: 1,
        missingSnapshot: 1,
        repositoryMismatch: 1,
        shaMismatch: 1,
        unsupportedEvent: 1,
        headRepositoryMismatch: 0,
      },
    ],
    totals: { legacy: 12, eligible: 5 },
  },
}

export const SelectTeam: Story = {
  name: 'Velg team før rapport',
  args: {
    teams: ['pensjondeployer', 'team-a'],
    selectedTeam: null,
    invalidTeam: false,
    repositories: [],
    totals: { legacy: 0, eligible: 0 },
  },
}

export const Empty: Story = {
  name: 'Ingen eldre deployments',
  args: {
    teams: ['pensjondeployer', 'team-a'],
    selectedTeam: 'pensjondeployer',
    invalidTeam: false,
    repositories: [],
    totals: { legacy: 0, eligible: 0 },
  },
}
