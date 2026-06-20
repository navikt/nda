import { HStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { MethodTag, StatusTag } from '../deployment-tags'

const meta: Meta = {
  title: 'Components/DeploymentTags',
}

export default meta

type Story = StoryObj

export const MethodTagVariants: Story = {
  name: 'MethodTag - Alle varianter',
  render: () => (
    <HStack gap="space-8" wrap>
      <MethodTag github_pr_number={123} four_eyes_status="approved" />
      <MethodTag github_pr_number={null} four_eyes_status="direct_push" />
      <MethodTag github_pr_number={null} four_eyes_status="legacy" />
      <MethodTag github_pr_number={null} four_eyes_status="pending" />
    </HStack>
  ),
}

export const StatusTagApproved: Story = {
  name: 'StatusTag - Godkjent',
  render: () => <StatusTag four_eyes_status="approved" />,
}

export const StatusTagPending: Story = {
  name: 'StatusTag - Venter',
  render: () => <StatusTag four_eyes_status="pending" />,
}

export const StatusTagDirectPush: Story = {
  name: 'StatusTag - Direct Push (ikke godkjent)',
  render: () => <StatusTag four_eyes_status="direct_push" />,
}

export const StatusTagUnverifiedCommits: Story = {
  name: 'StatusTag - Ikke-godkjente commits',
  render: () => <StatusTag four_eyes_status="unverified_commits" />,
}

export const StatusTagUnreviewed: Story = {
  name: 'StatusTag - Godkjent PR med ureviewed commits',
  render: () => <StatusTag four_eyes_status="approved_pr_with_unreviewed" />,
}

export const StatusTagError: Story = {
  name: 'StatusTag - Feil',
  render: () => <StatusTag four_eyes_status="error" />,
}

export const StatusTagLegacy: Story = {
  name: 'StatusTag - Legacy',
  render: () => <StatusTag four_eyes_status="legacy" />,
}

export const AllStatusTags: Story = {
  name: 'StatusTag - Alle varianter',
  render: () => (
    <HStack gap="space-8" wrap>
      <StatusTag four_eyes_status="approved" />
      <StatusTag four_eyes_status="pending" />
      <StatusTag four_eyes_status="direct_push" />
      <StatusTag four_eyes_status="unverified_commits" />
      <StatusTag four_eyes_status="approved_pr_with_unreviewed" />
      <StatusTag four_eyes_status="error" />
      <StatusTag four_eyes_status="legacy" />
    </HStack>
  ),
}
