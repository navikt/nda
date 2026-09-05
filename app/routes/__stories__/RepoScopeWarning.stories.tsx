import type { Meta, StoryObj } from '@storybook/react'
import { type RepoAffectedApp, RepoScopeWarning } from '~/components/RepoScopeSettings'

const affectedApps: RepoAffectedApp[] = [
  { id: 1, app_name: 'glad-fjord-api', team_slug: 'team-fjord', environment_name: 'prod-gcp' },
  { id: 2, app_name: 'glad-fjord-frontend', team_slug: 'team-fjord', environment_name: 'prod-gcp' },
  { id: 3, app_name: 'rask-elv-batch', team_slug: 'team-elv', environment_name: 'prod-fss' },
]

const meta: Meta<typeof RepoScopeWarning> = {
  title: 'Features/RepoScopeWarning',
  component: RepoScopeWarning,
}
export default meta
type Story = StoryObj<typeof RepoScopeWarning>

export const SeveralAppsShareTheRepo: Story = {
  args: { affectedApps, currentAppId: 1 },
}

export const OneOtherAppSharesTheRepo: Story = {
  args: { affectedApps: affectedApps.slice(0, 2), currentAppId: 1 },
}

export const OnlyThisApp: Story = {
  args: { affectedApps: affectedApps.slice(0, 1), currentAppId: 1 },
}
