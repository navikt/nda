import type { Meta, StoryObj } from '@storybook/react'
import { HomePage } from '~/routes/home.page'
import { mockApps, mockHomeDevTeams, mockHomeIssueApps, mockHomeTeamStats } from './mock-data'

const meta: Meta<typeof HomePage> = {
  title: 'Pages/Home',
  component: HomePage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof HomePage>

export const WithTeamsSelected: Story = {
  name: 'Med valgte team',
  args: {
    selectedDevTeams: mockHomeDevTeams.slice(0, 1),
    teamStats: mockHomeTeamStats,
    issueApps: mockHomeIssueApps,
  },
}

export const MultipleTeams: Story = {
  name: 'Flere team valgt',
  args: {
    selectedDevTeams: mockHomeDevTeams.slice(0, 2),
    teamStats: { ...mockHomeTeamStats, total_apps: 12, total_deployments: 98 },
    issueApps: mockHomeIssueApps,
  },
}

export const NoTeamSelected: Story = {
  name: 'Ingen team valgt',
  args: {
    selectedDevTeams: [],
    teamStats: null,
    issueApps: [],
    githubUsername: 'pcmoen',
  },
}

export const AllAppsOk: Story = {
  name: 'Alle applikasjoner i orden',
  args: {
    selectedDevTeams: mockHomeDevTeams.slice(0, 1),
    teamStats: { ...mockHomeTeamStats, apps_with_issues: 0, without_four_eyes: 0 },
    issueApps: [],
  },
}

export const HighCoverage: Story = {
  name: 'Høy dekning (95%+)',
  args: {
    selectedDevTeams: mockHomeDevTeams.slice(0, 1),
    teamStats: { ...mockHomeTeamStats, four_eyes_percentage: 98, apps_with_issues: 0 },
    issueApps: [],
  },
}

export const LowCoverage: Story = {
  name: 'Lav dekning (<80%)',
  args: {
    selectedDevTeams: mockHomeDevTeams.slice(0, 1),
    teamStats: { ...mockHomeTeamStats, four_eyes_percentage: 65, apps_with_issues: 3 },
    issueApps: mockApps.slice(0, 3),
  },
}

export const AdminView: Story = {
  name: 'Som admin',
  args: {
    selectedDevTeams: mockHomeDevTeams.slice(0, 1),
    teamStats: mockHomeTeamStats,
    issueApps: mockHomeIssueApps,
  },
}
