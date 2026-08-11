import type { Meta, StoryObj } from '@storybook/react'
import { GithubVerificationProgress } from '~/components/GithubVerificationProgress'

const meta: Meta<typeof GithubVerificationProgress> = {
  title: 'Features/GithubVerificationProgress',
  component: GithubVerificationProgress,
}
export default meta
type Story = StoryObj<typeof GithubVerificationProgress>

export const InitialSyncInProgress: Story = {
  args: {
    verified: 256,
    pending: 203,
    total: 459,
    verifyLimitPerCycle: 20,
    syncIntervalMs: 5 * 60 * 1000,
  },
}

export const NearlyComplete: Story = {
  args: {
    verified: 440,
    pending: 19,
    total: 459,
    verifyLimitPerCycle: 20,
    syncIntervalMs: 5 * 60 * 1000,
  },
}

export const LargeBacklog: Story = {
  args: {
    verified: 20,
    pending: 980,
    total: 1000,
    verifyLimitPerCycle: 20,
    syncIntervalMs: 5 * 60 * 1000,
  },
}
