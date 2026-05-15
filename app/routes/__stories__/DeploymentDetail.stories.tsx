import type { Meta, StoryObj } from '@storybook/react'
import { type DeploymentDetail, DeploymentDetailPage } from '~/components/DeploymentDetailPage'

const meta: Meta<typeof DeploymentDetailPage> = {
  title: 'Pages/DeploymentDetail',
  component: DeploymentDetailPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeploymentDetailPage>

const baseDeployment: DeploymentDetail = {
  id: 123,
  commit_sha: 'abc123def456789012345678901234567890abcd',
  commit_message:
    'feat: Add new feature for pension calculation\n\nThis commit adds support for the new calculation model.',
  deployer_username: 'john-doe',
  deploy_started_at: '2026-02-08T10:30:00Z',
  four_eyes_status: 'approved',
  approval_source: 'pr_approval',
  github_pr_number: 42,
  github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/42',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'pensjon-pen',
  github_pr_data: {
    title: 'feat: Add new feature for pension calculation',
    creator: { username: 'john-doe' },
    merger: { username: 'jane-smith' },
    reviewers: [
      { username: 'jane-smith', state: 'APPROVED', submitted_at: '2026-02-08T09:45:00Z' },
      { username: 'bob-wilson', state: 'APPROVED', submitted_at: '2026-02-08T10:15:00Z' },
    ],
  },
}

export const Approved: Story = {
  name: 'Godkjent',
  args: {
    deployment: baseDeployment,
    previousId: 122,
    nextId: 124,
    isAdmin: false,
  },
}

export const NotApproved: Story = {
  name: 'Ikke godkjent',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'unverified_commits',
      approval_source: null,
    },
    previousId: 122,
    nextId: 124,
    isAdmin: true,
  },
}

export const Pending: Story = {
  name: 'Venter verifisering',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'pending',
      approval_source: null,
    },
    previousId: null,
    nextId: 124,
    isAdmin: true,
  },
}

export const DirectPush: Story = {
  name: 'Direct Push (ingen PR)',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'direct_push',
      github_pr_number: null,
      github_pr_url: null,
      github_pr_data: undefined,
      commit_message: 'hotfix: Emergency fix for production bug',
    },
    previousId: 122,
    nextId: null,
    isAdmin: true,
  },
}

export const ManuallyApproved: Story = {
  name: 'Manuelt godkjent',
  args: {
    deployment: {
      ...baseDeployment,
      four_eyes_status: 'manually_approved',
      approval_source: 'manual',
    },
    previousId: 122,
    nextId: 124,
    isAdmin: false,
  },
}
