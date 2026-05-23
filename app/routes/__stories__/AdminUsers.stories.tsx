import type { Meta, StoryObj } from '@storybook/react'
import { AdminUsersPage } from '~/components/AdminUsersPage'

type UserMapping = {
  github_username: string
  display_github_username: string
  display_name: string | null
  nav_email: string | null
  nav_ident: string | null
  slack_member_id: string | null
}

type UnmappedUser = {
  github_username: string
  deployment_count: number
}

const mockMappings: UserMapping[] = [
  {
    github_username: 'glad-fjord',
    display_github_username: 'Glad-Fjord',
    display_name: 'Glad Fjord',
    nav_email: 'glad.fjord@nav.no',
    nav_ident: 'Z990001',
    slack_member_id: 'U12345678',
  },
  {
    github_username: 'rask-elv',
    display_github_username: 'Rask-Elv',
    display_name: 'Rask Elv',
    nav_email: 'rask.elv@nav.no',
    nav_ident: 'Z990002',
    slack_member_id: 'U87654321',
  },
  {
    github_username: 'dev-user',
    display_github_username: 'dev-user',
    display_name: null,
    nav_email: 'dev.user@nav.no',
    nav_ident: null,
    slack_member_id: null,
  },
  {
    github_username: 'minimal-user',
    display_github_username: 'minimal-user',
    display_name: null,
    nav_email: null,
    nav_ident: null,
    slack_member_id: null,
  },
]

const mockUnmappedUsers: UnmappedUser[] = [
  { github_username: 'unknown-deployer', deployment_count: 12 },
  { github_username: 'new-hire', deployment_count: 3 },
]

const meta: Meta<typeof AdminUsersPage> = {
  title: 'Pages/AdminUsers',
  component: AdminUsersPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof AdminUsersPage>

export const Default: Story = {
  args: {
    mappings: mockMappings,
    unmappedUsers: [],
    onAdd: () => {},
    onEdit: () => {},
    onAddMapping: () => {},
  },
}

export const WithUnmappedUsers: Story = {
  name: 'Med umappede brukere',
  args: {
    mappings: mockMappings,
    unmappedUsers: mockUnmappedUsers,
    onAdd: () => {},
    onEdit: () => {},
    onAddMapping: () => {},
  },
}

export const Empty: Story = {
  name: 'Ingen brukere',
  args: {
    mappings: [],
    unmappedUsers: [],
    onAdd: () => {},
  },
}

export const MinimalData: Story = {
  name: 'Kun GitHub-brukernavn',
  args: {
    mappings: [
      {
        github_username: 'solo-user',
        display_github_username: 'solo-user',
        display_name: null,
        nav_email: null,
        nav_ident: null,
        slack_member_id: null,
      },
    ],
    unmappedUsers: [],
    onAdd: () => {},
    onEdit: () => {},
  },
}

export const OnlyUnmapped: Story = {
  name: 'Kun umappede brukere',
  args: {
    mappings: [],
    unmappedUsers: mockUnmappedUsers,
    onAdd: () => {},
    onAddMapping: () => {},
  },
}
