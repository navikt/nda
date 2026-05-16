import type { Meta, StoryObj } from '@storybook/react'
import { TeamPage } from '~/components/TeamPage'
import { groupAppsByEnvironment } from '~/lib/group-apps-by-environment'
import { mockApps } from './mock-data'

const meta: Meta<typeof TeamPage> = {
  title: 'Pages/Team',
  component: TeamPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof TeamPage>

// Group mock apps by environment for pensjondeployer team
const pensjondeployerApps = mockApps.filter((app) => app.team_slug === 'pensjondeployer')
const appsByEnvPensjondeployer = groupAppsByEnvironment(pensjondeployerApps)

export const Default: Story = {
  args: {
    team: 'pensjondeployer',
    appsByEnv: appsByEnvPensjondeployer,
  },
}

export const SingleEnvironment: Story = {
  name: 'Ett miljø',
  args: {
    team: 'pensjondeployer',
    appsByEnv: {
      'prod-fss': pensjondeployerApps.filter((app) => app.environment_name === 'prod-fss'),
    },
  },
}

export const MultipleEnvironments: Story = {
  name: 'Flere miljøer',
  args: {
    team: 'pensjondeployer',
    appsByEnv: {
      'prod-fss': [mockApps[0], mockApps[1]],
      'prod-gcp': [mockApps[2]],
      'dev-fss': [{ ...mockApps[0], id: 10, environment_name: 'dev-fss' }],
    },
  },
}
