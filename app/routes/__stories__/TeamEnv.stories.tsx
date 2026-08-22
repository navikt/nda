import type { Meta, StoryObj } from '@storybook/react'
import { TeamEnvPage } from '~/components/TeamEnvPage'
import { mockApps } from './mock-data'

const meta: Meta<typeof TeamEnvPage> = {
  title: 'Pages/TeamEnv',
  component: TeamEnvPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof TeamEnvPage>

const prodFssApps = mockApps.filter((app) => app.team_slug === 'pensjondeployer' && app.environment_name === 'prod-fss')

export const Default: Story = {
  args: {
    team: 'pensjondeployer',
    env: 'prod-fss',
    apps: prodFssApps,
  },
}

export const SingleApp: Story = {
  name: 'Én app',
  args: {
    team: 'pensjondeployer',
    env: 'prod-gcp',
    apps: [mockApps[2]], // pensjon-opptjening
  },
}

export const ManyApps: Story = {
  name: 'Mange applikasjoner',
  args: {
    team: 'pensjondeployer',
    env: 'prod-fss',
    apps: [
      ...prodFssApps,
      { ...mockApps[0], id: 10, app_name: 'pensjon-api' },
      { ...mockApps[0], id: 11, app_name: 'pensjon-frontend' },
      { ...mockApps[0], id: 12, app_name: 'pensjon-batch' },
    ],
  },
}
