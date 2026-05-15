import type { Meta, StoryObj } from '@storybook/react'
import { UserProfilePage } from '~/components/UserProfilePage'
import { mockDeployments, mockUserMapping } from './mock-data'

const meta: Meta<typeof UserProfilePage> = {
  title: 'Pages/User',
  component: UserProfilePage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof UserProfilePage>

export const Default: Story = {
  args: {
    username: 'john-doe',
    mapping: mockUserMapping,
    deploymentCount: 42,
    recentDeployments: mockDeployments,
  },
}

export const NoMapping: Story = {
  name: 'Uten mapping',
  args: {
    username: 'unknown-user',
    mapping: null,
    deploymentCount: 5,
    recentDeployments: mockDeployments.slice(0, 2),
  },
}

export const PartialMapping: Story = {
  name: 'Delvis mapping',
  args: {
    username: 'partial-user',
    mapping: {
      github_username: 'partial-user',
      display_name: 'Partial User',
      nav_email: null,
      nav_ident: 'A123456',
      slack_member_id: null,
    },
    deploymentCount: 10,
    recentDeployments: mockDeployments,
  },
}

export const NoDeployments: Story = {
  name: 'Ingen deployments',
  args: {
    username: 'new-user',
    mapping: mockUserMapping,
    deploymentCount: 0,
    recentDeployments: [],
  },
}
