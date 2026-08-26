import type { Meta, StoryObj } from '@storybook/react'
import { SlackHistoryLink } from './SlackHistoryLink'

const meta: Meta<typeof SlackHistoryLink> = {
  title: 'Features/Admin/SlackHistoryLink',
  component: SlackHistoryLink,
}
export default meta
type Story = StoryObj<typeof SlackHistoryLink>

export const Default: Story = {
  name: 'Lenke til Slack-historikk',
  args: {
    teamSlug: 'pensjondeployer',
    environmentName: 'prod-fss',
    appName: 'pensjon-pen',
  },
}
