import type { Meta, StoryObj } from '@storybook/react'
import { AdminPage } from '~/components/AdminPage'

const meta: Meta<typeof AdminPage> = {
  title: 'Pages/Admin',
  component: AdminPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof AdminPage>

export const Default: Story = {
  args: {
    pendingCount: 0,
    diffCount: 0,
    softDeletedCount: 0,
    titleMismatchCount: 0,
    baselineNoApproverCount: 0,
  },
}

export const WithPendingVerifications: Story = {
  name: 'Med ventende verifiseringer',
  args: {
    pendingCount: 5,
    diffCount: 0,
    softDeletedCount: 0,
    titleMismatchCount: 0,
    baselineNoApproverCount: 0,
  },
}

export const WithMultipleDeviations: Story = {
  name: 'Med flere avvik',
  args: {
    pendingCount: 3,
    diffCount: 2,
    softDeletedCount: 4,
    titleMismatchCount: 1,
    baselineNoApproverCount: 2,
  },
}
