import type { Meta, StoryObj } from '@storybook/react'
import { NaisApplySettings } from '~/routes/team/$team.env.$env.app.$app.admin/NaisApplySettings'

const meta: Meta<typeof NaisApplySettings> = {
  title: 'Features/NaisApplySettings',
  component: NaisApplySettings,
}

export default meta
type Story = StoryObj<typeof NaisApplySettings>

export const Disabled: Story = {
  args: {
    appId: 1,
    enabled: false,
    syncState: { initialHistorySyncedAt: null, lastSyncedAt: null, hasError: false },
  },
}

export const Enabled: Story = {
  args: {
    appId: 1,
    enabled: true,
    syncState: {
      initialHistorySyncedAt: '2026-10-15T10:00:00.000Z',
      lastSyncedAt: '2026-10-15T10:00:00.000Z',
      hasError: false,
    },
  },
}
