import type { Meta, StoryObj } from '@storybook/react'
import { NaisHistoryRecoveryPage } from '~/components/NaisHistoryRecoveryPage'

const meta: Meta<typeof NaisHistoryRecoveryPage> = {
  title: 'Pages/NaisHistoryRecovery',
  component: NaisHistoryRecoveryPage,
}

export default meta
type Story = StoryObj<typeof NaisHistoryRecoveryPage>

export const Default: Story = {
  args: {
    candidates: [
      {
        id: 1,
        team_slug: 'pensjon',
        environment_name: 'prod-gcp',
        app_name: 'pensjon-alde',
        initial_nais_history_synced_at: new Date('2026-01-14T12:00:00Z'),
        latest_sync_status: 'completed',
        latest_sync_started_at: new Date('2026-01-14T12:00:00Z'),
        latest_sync_version: '2.4.0',
        latest_sync_is_active: false,
      },
    ],
    search: '',
  },
}

export const WithRisks: Story = {
  args: {
    ...Default.args,
    riskApps: [
      {
        app_id: 1,
        team_slug: 'pensjon',
        environment_name: 'prod-gcp',
        app_name: 'pensjon-alde',
        initial_nais_history_synced_at: new Date('2026-01-14T12:00:00Z'),
        completed_syncs: 1,
        failed_since_last_completed: 1,
        last_completed_at: new Date('2026-01-14T12:01:00Z'),
        last_error: 'Nais deployment ID abc is already stored for a different monitored application',
        id_collision: true,
        marker_without_completed_job: false,
        deployment_count: 42,
      },
    ],
  },
}
