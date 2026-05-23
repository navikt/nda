import type { Meta, StoryObj } from '@storybook/react'
import { UnmappedUsersList } from '~/components/UnmappedUsersList'

const meta: Meta<typeof UnmappedUsersList> = {
  title: 'Components/UnmappedUsersList',
  component: UnmappedUsersList,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof UnmappedUsersList>

export const Default: Story = {
  args: {
    users: [
      { github_username: 'unknown-deployer', deployment_count: 12 },
      { github_username: 'new-hire', deployment_count: 3 },
      { github_username: 'external-contributor', deployment_count: 1 },
    ],
    onAddMapping: () => {},
  },
}

export const SingleUser: Story = {
  name: 'Én bruker',
  args: {
    users: [{ github_username: 'solo-deployer', deployment_count: 7 }],
    onAddMapping: () => {},
  },
}

export const ReadOnly: Story = {
  name: 'Uten handlinger',
  args: {
    users: [
      { github_username: 'unknown-deployer', deployment_count: 12 },
      { github_username: 'new-hire', deployment_count: 3 },
    ],
  },
}

export const Empty: Story = {
  name: 'Tom liste',
  args: {
    users: [],
  },
}
