import type { Meta, StoryObj } from '@storybook/react'
import { CodeDeliveryTrackingSettings } from './CodeDeliveryTrackingSettings'

const meta: Meta<typeof CodeDeliveryTrackingSettings> = {
  title: 'Features/RepositoryAdmin/CodeDeliveryTrackingSettings',
  component: CodeDeliveryTrackingSettings,
}
export default meta
type Story = StoryObj<typeof CodeDeliveryTrackingSettings>

export const Av: Story = {
  name: 'Registrering av kodeleveranser - av',
  args: {
    repositoryId: 5,
    codeDeliveryTracking: { enabled: false, since: null },
  },
}

export const Paa: Story = {
  name: 'Registrering av kodeleveranser - på',
  args: {
    repositoryId: 5,
    codeDeliveryTracking: { enabled: true, since: '2026-10-13T08:00:00.000Z' },
  },
}
