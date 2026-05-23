import type { Meta, StoryObj } from '@storybook/react'
import { SlackBlockPreview } from '~/components/__stories__/SlackBlockPreview'
import { deploymentFixtures } from '~/lib/__fixtures__/slack-fixtures'
import { buildDeploymentBlocks } from '~/lib/slack'

const meta: Meta<typeof SlackBlockPreview> = {
  title: 'Slack/Deployment Notification',
  component: SlackBlockPreview,
}

export default meta
type Story = StoryObj<typeof SlackBlockPreview>

export const Unverified: Story = {
  name: '⚠️ Ikke godkjent (med PR)',
  args: {
    blocks: buildDeploymentBlocks(deploymentFixtures.unverified),
  },
}

export const UnverifiedWithoutPr: Story = {
  name: '⚠️ Ikke godkjent (uten PR)',
  args: {
    blocks: buildDeploymentBlocks(deploymentFixtures.unverifiedWithoutPr),
  },
}

export const Pending: Story = {
  name: '⏳ Venter godkjenning',
  args: {
    blocks: buildDeploymentBlocks(deploymentFixtures.pending),
  },
}

export const Approved: Story = {
  name: '✅ Godkjent',
  args: {
    blocks: buildDeploymentBlocks(deploymentFixtures.approved),
  },
}

export const Rejected: Story = {
  name: '❌ Avvist',
  args: {
    blocks: buildDeploymentBlocks(deploymentFixtures.rejected),
  },
}

export const LongCommitMessage: Story = {
  name: '📝 Lang commit-melding (trunkert)',
  args: {
    blocks: buildDeploymentBlocks(deploymentFixtures.longCommitMessage),
  },
}
