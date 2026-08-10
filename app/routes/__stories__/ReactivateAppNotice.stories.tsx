import type { Meta, StoryObj } from '@storybook/react'
import { ReactivateAppNotice } from '~/components/ReactivateAppNotice'

const meta: Meta<typeof ReactivateAppNotice> = {
  title: 'Features/ReactivateAppNotice',
  component: ReactivateAppNotice,
}
export default meta
type Story = StoryObj<typeof ReactivateAppNotice>

export const Default: Story = {
  args: { appId: 1 },
}
