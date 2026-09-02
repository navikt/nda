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

export const Default: Story = {}
