import type { Meta, StoryObj } from '@storybook/react'
import { DefaultBranchSettings } from './DefaultBranchSettings'

const meta: Meta<typeof DefaultBranchSettings> = {
  title: 'Features/RepositoryAdmin/DefaultBranchSettings',
  component: DefaultBranchSettings,
}
export default meta
type Story = StoryObj<typeof DefaultBranchSettings>

export const Default: Story = {
  name: 'Default branch-innstillinger',
  args: {
    repositoryId: 5,
    defaultBranch: 'main',
    affectedApps: [
      { id: 1, app_name: 'pensjon-pen', team_slug: 'pensjondeployer', environment_name: 'prod-fss' },
      { id: 2, app_name: 'pensjon-selvbetjening-web', team_slug: 'pensjondeployer', environment_name: 'prod-gcp' },
    ],
  },
}

export const IngenBranchSatt: Story = {
  name: 'Ingen branch satt',
  args: {
    repositoryId: 5,
    defaultBranch: null,
    affectedApps: [],
  },
}
