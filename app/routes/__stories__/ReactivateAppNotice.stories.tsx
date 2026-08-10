import type { Meta, StoryObj } from '@storybook/react'
import { ReactivateAppNotice } from '~/components/ReactivateAppNotice'

const meta: Meta<typeof ReactivateAppNotice> = {
  title: 'Features/ReactivateAppNotice',
  component: ReactivateAppNotice,
}
export default meta
type Story = StoryObj<typeof ReactivateAppNotice>

export const WithReactivate: Story = {
  args: { canReactivate: true, appId: 1 },
}

export const WithoutReactivate: Story = {
  args: { canReactivate: false },
}
