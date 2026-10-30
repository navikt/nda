import type { Meta, StoryObj } from '@storybook/react'
import { NaisApplyStatus } from '~/routes/team/$team.env.$env.app.$app.admin/NaisApplyStatus'

const meta: Meta<typeof NaisApplyStatus> = {
  title: 'Features/NaisApplyStatus',
  component: NaisApplyStatus,
}

export default meta
type Story = StoryObj<typeof NaisApplyStatus>

export const InitialSyncPending: Story = {
  args: {
    syncState: { initialHistorySyncedAt: null, lastSyncedAt: null, hasError: false },
  },
}

export const Synced: Story = {
  args: {
    syncState: {
      initialHistorySyncedAt: '2026-10-15T10:00:00.000Z',
      lastSyncedAt: '2026-10-15T10:00:00.000Z',
      hasError: false,
    },
  },
}

export const SyncFailed: Story = {
  args: {
    syncState: { initialHistorySyncedAt: null, lastSyncedAt: null, hasError: true },
  },
}
