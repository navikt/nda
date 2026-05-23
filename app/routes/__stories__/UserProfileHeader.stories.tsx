import type { Meta, StoryObj } from '@storybook/react'
import { UserProfileHeader } from '~/components/UserProfileHeader'

const meta: Meta<typeof UserProfileHeader> = {
  title: 'Components/UserProfileHeader',
  component: UserProfileHeader,
  parameters: {
    layout: 'padded',
  },
}

export default meta

type Story = StoryObj<typeof UserProfileHeader>

export const FullMapping: Story = {
  name: 'Komplett mapping',
  args: {
    username: 'glad-fjord',
    displayName: 'Glad Fjord',
    identity: {
      nav_email: 'glad.fjord@nav.no',
      nav_ident: 'Z990001',
      slack_member_id: 'U12345678',
    },
  },
}

export const PartialMapping: Story = {
  name: 'Delvis mapping',
  args: {
    username: 'rask-elv',
    displayName: 'Rask Elv',
    identity: {
      nav_email: null,
      nav_ident: 'Z990002',
      slack_member_id: null,
    },
  },
}

export const NoMapping: Story = {
  name: 'Uten mapping',
  args: {
    username: 'unknown-user',
    identity: null,
  },
}

export const BotUser: Story = {
  name: 'Bot-bruker',
  args: {
    username: 'dependabot[bot]',
    displayName: 'Dependabot',
    isBot: true,
    botDescription: 'Automatisk avhengighetsoppdatering',
    identity: null,
  },
}
