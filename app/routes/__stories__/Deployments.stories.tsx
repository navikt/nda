import type { Meta, StoryObj } from '@storybook/react'
import { DeploymentsPage } from '~/components/deployments'
import { mockDeployments } from './mock-data'

const meta: Meta<typeof DeploymentsPage> = {
  title: 'Pages/Deployments',
  component: DeploymentsPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeploymentsPage>

const fullDeployments = mockDeployments.map((d) => ({
  ...d,
  title: d.commit_message,
  deployer_username: d.deployer,
  detected_github_owner: d.github_owner,
  detected_github_repo_name: d.github_repo_name,
  github_pr_data: null,
  github_pr_number: 42,
  github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/42',
}))

export const Default: Story = {
  args: {
    deployments: fullDeployments,
    total: 42,
    page: 1,
    totalPages: 3,
    userMappings: {},
  },
}

export const Empty: Story = {
  name: 'Ingen resultater',
  args: {
    deployments: [],
    total: 0,
    page: 1,
    totalPages: 0,
    userMappings: {},
  },
}

export const SinglePage: Story = {
  name: 'Én side',
  args: {
    deployments: fullDeployments,
    total: 3,
    page: 1,
    totalPages: 1,
    userMappings: {},
  },
}

export const MiddlePage: Story = {
  name: 'Midterste side',
  args: {
    deployments: fullDeployments,
    total: 100,
    page: 3,
    totalPages: 5,
    userMappings: {},
  },
}

export const MixedStatuses: Story = {
  name: 'Blandet status',
  args: {
    deployments: [
      { ...fullDeployments[0], four_eyes_status: 'approved' },
      { ...fullDeployments[1], four_eyes_status: 'direct_push' },
      { ...fullDeployments[2], four_eyes_status: 'pending' },
      {
        ...fullDeployments[0],
        id: 4,
        four_eyes_status: 'manually_approved',
        title: 'Manuelt godkjent deployment',
      },
      {
        ...fullDeployments[0],
        id: 5,
        four_eyes_status: 'error',
        title: 'Deployment med feil',
      },
    ],
    total: 5,
    page: 1,
    totalPages: 1,
    userMappings: {},
  },
}
