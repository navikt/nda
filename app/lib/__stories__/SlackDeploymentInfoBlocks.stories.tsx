import type { Meta, StoryObj } from '@storybook/react'
import { SlackBlockPreview } from '~/components/__stories__/SlackBlockPreview'
import { newDeploymentFixtures } from '~/lib/__fixtures__/slack-fixtures'
import { buildNewDeploymentBlocks } from '~/lib/slack'

const meta: Meta<typeof SlackBlockPreview> = {
  title: 'Slack/Deployment Info Notification',
  component: SlackBlockPreview,
}

export default meta
type Story = StoryObj<typeof SlackBlockPreview>

export const WithPr: Story = {
  name: '🚀 Med PR (godkjent)',
  args: {
    blocks: buildNewDeploymentBlocks(newDeploymentFixtures.withPr),
  },
}

export const WithPrSlackMentions: Story = {
  name: '🚀 Med PR (godkjent) — med Slack-mentions',
  args: {
    blocks: buildNewDeploymentBlocks(newDeploymentFixtures.withPrSlackMentions),
  },
}

export const DirectPush: Story = {
  name: '⚠️ Direkte push (ingen PR)',
  args: {
    blocks: buildNewDeploymentBlocks(newDeploymentFixtures.directPush),
  },
}

export const Violation: Story = {
  name: '❌ Selvgodkjent (avvik)',
  args: {
    blocks: buildNewDeploymentBlocks(newDeploymentFixtures.violation),
  },
}

export const Legacy: Story = {
  name: '📦 Legacy-deploy',
  args: {
    blocks: buildNewDeploymentBlocks(newDeploymentFixtures.legacy),
  },
}
