import type { Meta, StoryObj } from '@storybook/react'
import { AuditStartYearSettings } from './AuditStartYearSettings'

const meta: Meta<typeof AuditStartYearSettings> = {
  title: 'Features/RepositoryAdmin/AuditStartYearSettings',
  component: AuditStartYearSettings,
}
export default meta
type Story = StoryObj<typeof AuditStartYearSettings>

export const Default: Story = {
  name: 'Startår for revisjon satt',
  args: {
    repositoryId: 5,
    auditStartYear: 2022,
    affectedApps: [{ id: 1, app_name: 'pensjon-pen', team_slug: 'pensjondeployer', environment_name: 'prod-fss' }],
  },
}

export const IkkeSatt: Story = {
  name: 'Startår ikke satt',
  args: {
    repositoryId: 5,
    auditStartYear: null,
    affectedApps: [],
  },
}
