import type { Meta, StoryObj } from '@storybook/react'
import { UserPageContent } from '~/components/UserPageContent'
import { mockUserMapping } from './mock-data'

const mockDeployments = [
  {
    id: 1,
    app_name: 'pensjon-pen',
    environment_name: 'prod-fss',
    team_slug: 'pensjondeployer',
    created_at: '2026-02-08T10:30:00Z',
    title: 'feat: Add new feature',
    github_pr_number: 42,
    four_eyes_status: 'approved',
    has_goal_link: true,
    is_dependabot: false,
  },
  {
    id: 2,
    app_name: 'pensjon-pen',
    environment_name: 'prod-fss',
    team_slug: 'pensjondeployer',
    created_at: '2026-02-07T15:00:00Z',
    title: 'fix: Bug fix',
    github_pr_number: null,
    four_eyes_status: 'direct_push',
    has_goal_link: false,
    is_dependabot: false,
  },
  {
    id: 3,
    app_name: 'pensjon-pen',
    environment_name: 'prod-fss',
    team_slug: 'pensjondeployer',
    created_at: '2026-02-06T09:00:00Z',
    title: 'chore: Update dependencies',
    github_pr_number: 40,
    four_eyes_status: 'pending',
    has_goal_link: false,
    is_dependabot: true,
  },
]

const defaultArgs = {
  username: 'glad-fjord',
  mapping: mockUserMapping,
  isBot: false,
  devTeams: [
    { id: 1, name: 'Pensjon Pen', slug: 'pensjon-pen', section_slug: 'say' },
    { id: 2, name: 'Pensjon Samhandling', slug: 'pensjon-samhandling', section_slug: 'say' },
  ],
  userRoles: { sectionRoles: [], teamRoles: [] },
  deploymentCount: 42,
  paginatedDeployments: {
    deployments: mockDeployments,
    total: 42,
    page: 1,
    total_pages: 3,
  },
  monthlyStats: [
    { month: '2026-01', total: 12, with_goal: 10, without_goal: 2, dependabot: 3 },
    { month: '2025-12', total: 8, with_goal: 6, without_goal: 2, dependabot: 1 },
    { month: '2025-11', total: 15, with_goal: 12, without_goal: 3, dependabot: 5 },
    { month: '2025-10', total: 7, with_goal: 5, without_goal: 2, dependabot: 2 },
  ],
  deployerApps: ['pensjon-pen', 'pensjon-selvbetjening'],
  period: 'all' as const,
  goalFilter: 'all',
  dependabotFilter: 'all',
  approvalFilter: 'all',
  appFilter: '',
  hasFilters: false,
  availableBoards: [],
  isOwnProfile: false,
  landingPage: 'my-teams',
  allSections: [],
}

const meta: Meta<typeof UserPageContent> = {
  title: 'Pages/User',
  component: UserPageContent,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof UserPageContent>

export const Default: Story = {
  args: defaultArgs,
}

export const NoMapping: Story = {
  name: 'Uten mapping',
  args: {
    ...defaultArgs,
    username: 'unknown-user',
    mapping: null,
    deploymentCount: 5,
    paginatedDeployments: {
      deployments: mockDeployments.slice(0, 2),
      total: 5,
      page: 1,
      total_pages: 1,
    },
    devTeams: [],
    monthlyStats: [],
  },
}

export const PartialMapping: Story = {
  name: 'Delvis mapping',
  args: {
    ...defaultArgs,
    username: 'partial-user',
    mapping: {
      github_username: 'partial-user',
      display_name: 'Rolig Dal',
      nav_email: null,
      nav_ident: 'Z990001',
      slack_member_id: null,
    },
    deploymentCount: 10,
  },
}

export const NoDeployments: Story = {
  name: 'Ingen deployments',
  args: {
    ...defaultArgs,
    username: 'new-user',
    deploymentCount: 0,
    paginatedDeployments: {
      deployments: [],
      total: 0,
      page: 1,
      total_pages: 0,
    },
    monthlyStats: [],
  },
}

export const OwnProfile: Story = {
  name: 'Egen profil',
  args: {
    ...defaultArgs,
    isOwnProfile: true,
    onLandingPageChange: () => {},
    allSections: [
      { slug: 'say', name: 'Seksjon A&Y' },
      { slug: 'pensjon', name: 'Pensjon' },
    ],
  },
}

export const WithGoalLinking: Story = {
  name: 'Med endringsopphav-kobling',
  args: {
    ...defaultArgs,
    availableBoards: [
      { id: 1, period_label: 'Q1 2026', dev_team_name: 'Pensjon Pen' },
      { id: 2, period_label: 'Q2 2026', dev_team_name: 'Pensjon Pen' },
    ],
  },
}
