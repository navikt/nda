import type { Meta, StoryObj } from '@storybook/react'
import { UserMappingCard } from '~/components/UserMappingCard'

const meta: Meta<typeof UserMappingCard> = {
  title: 'Components/UserMappingCard',
  component: UserMappingCard,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof UserMappingCard>

export const FullMapping: Story = {
  name: 'Full mapping',
  args: {
    mapping: {
      github_username: 'glad-fjord',
      display_github_username: 'Glad-Fjord',
      display_name: 'Glad Fjord',
      nav_email: 'glad.fjord@nav.no',
      nav_ident: 'Z990001',
      slack_member_id: 'U12345678',
    },
    onEdit: () => {},
    onDelete: () => {},
  },
}

export const MinimalMapping: Story = {
  name: 'Kun GitHub-brukernavn',
  args: {
    mapping: {
      github_username: 'stille-skog',
      display_github_username: 'StilleSkog',
      display_name: null,
      nav_email: null,
      nav_ident: null,
      slack_member_id: null,
    },
    onEdit: () => {},
    onDelete: () => {},
  },
}

export const WithRoles: Story = {
  name: 'Med roller',
  render: () => (
    <UserMappingCard
      mapping={{
        github_username: 'rask-elv',
        display_github_username: 'Rask-Elv',
        display_name: 'Rask Elv',
        nav_email: 'rask.elv@nav.no',
        nav_ident: 'Z990002',
        slack_member_id: 'U87654321',
      }}
      teamRoles={[
        { dev_team_id: 1, role: 'produktleder' },
        { dev_team_id: 2, role: 'utvikler' },
      ]}
      sectionRoles={[{ section_id: 1, section_name: 'IT-avdelingen', role: 'seksjonsleder' }]}
      devTeamById={
        new Map([
          [1, { id: 1, name: 'Team Dagpenger' }],
          [2, { id: 2, name: 'Team Sykepenger' }],
        ])
      }
      onEdit={() => {}}
      onDelete={() => {}}
    />
  ),
}

export const ReadOnly: Story = {
  name: 'Uten handlinger',
  args: {
    mapping: {
      github_username: 'modig-bjork',
      display_github_username: 'ModigBjork',
      display_name: 'Modig Bjørk',
      nav_email: 'modig.bjork@nav.no',
      nav_ident: 'Z990003',
      slack_member_id: null,
    },
  },
}
