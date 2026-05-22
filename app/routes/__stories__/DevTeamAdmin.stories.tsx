import type { Meta, StoryObj } from '@storybook/react'
import { DevTeamAdminPage } from '~/components/DevTeamAdminPage'

const mockRoleMembers = [
  {
    id: 1,
    nav_ident: 'Z990001',
    role: 'utvikler',
    github_username: 'pensjon-dev-1',
    display_name: 'Rask Elv',
    assigned_at: '2026-01-10T12:00:00Z',
  },
  {
    id: 2,
    nav_ident: 'Z990002',
    role: 'techlead',
    github_username: 'pensjon-dev-2',
    display_name: 'Glad Fjord',
    assigned_at: '2026-01-12T08:30:00Z',
  },
]

const mockLinkedApps = [
  { monitored_app_id: 1, team_slug: 'pensjondeployer', environment_name: 'prod-fss', app_name: 'pensjon-pen' },
  {
    monitored_app_id: 2,
    team_slug: 'pensjondeployer',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-selvbetjening',
  },
]

const mockBoards = [
  {
    id: 1,
    period_type: 'tertiary',
    period_label: 'T1 2026',
    period_start: '2026-01-01',
    period_end: '2026-04-30',
    is_active: true,
  },
]

const meta: Meta<typeof DevTeamAdminPage> = {
  title: 'Pages/DevTeamAdmin',
  component: DevTeamAdminPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '900px', padding: '2rem' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DevTeamAdminPage>

export const Default: Story = {
  args: {
    devTeam: {
      name: 'Motta Pensjon',
      slug: 'starte-pensjon',
      nais_team_slugs: ['pensjondeployer', 'pensjonsamhandling'],
    },
    roleMembers: mockRoleMembers,
    linkedApps: mockLinkedApps,
    addableApps: [],
    naisCatalogFailed: false,
    boards: mockBoards,
    canAdmin: true,
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    isSubmitting: false,
    actionData: { success: 'Lagret' },
  },
}

export const EmptyTeam: Story = {
  name: 'Tomt team',
  args: {
    devTeam: { name: 'Modig Bjork', slug: 'nytt-team', nais_team_slugs: [] },
    roleMembers: [],
    linkedApps: [],
    addableApps: [],
    naisCatalogFailed: false,
    boards: [],
    canAdmin: true,
    teamBasePath: '/sections/pensjon/teams/nytt-team',
    isSubmitting: false,
    actionData: undefined,
  },
}

export const RoleOnlyAccess: Story = {
  name: 'Kun rolleadmin',
  args: {
    devTeam: { name: 'Motta Pensjon', slug: 'starte-pensjon', nais_team_slugs: ['pensjondeployer'] },
    roleMembers: mockRoleMembers,
    linkedApps: mockLinkedApps,
    addableApps: [],
    naisCatalogFailed: false,
    boards: mockBoards,
    canAdmin: false,
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    isSubmitting: false,
    actionData: undefined,
  },
}
