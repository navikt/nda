import type { Meta, StoryObj } from '@storybook/react'
import { NotFoundInNaisNotice } from '~/components/NotFoundInNaisNotice'

const meta: Meta<typeof NotFoundInNaisNotice> = {
  title: 'Features/NotFoundInNaisNotice',
  component: NotFoundInNaisNotice,
}
export default meta
type Story = StoryObj<typeof NotFoundInNaisNotice>

export const AlertWithDeactivate: Story = {
  args: { variant: 'alert', canDeactivate: true },
}

export const AlertWithoutDeactivate: Story = {
  args: { variant: 'alert', canDeactivate: false },
}

export const PanelWithDeactivate: Story = {
  args: { variant: 'panel', canDeactivate: true },
}
