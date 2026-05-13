import type { Meta, StoryObj } from '@storybook/react'
import { type RoleMember, RoleMembersSection, type UserOption } from '~/components/RoleMembersSection'

const mockRoleMembers: RoleMember[] = [
  {
    id: 1,
    nav_ident: 'A123456',
    role: 'produktleder',
    github_username: 'glad-fjord',
    display_name: 'Glad Fjord',
    assigned_at: '2026-03-15T10:00:00Z',
  },
  {
    id: 2,
    nav_ident: 'B654321',
    role: 'tech_lead',
    github_username: 'rask-elv',
    display_name: 'Rask Elv',
    assigned_at: '2026-03-20T14:30:00Z',
  },
  {
    id: 3,
    nav_ident: 'C789012',
    role: 'utvikler',
    github_username: 'stille-skog',
    display_name: 'Stille Skog',
    assigned_at: '2026-04-01T09:00:00Z',
  },
  {
    id: 4,
    nav_ident: 'D345678',
    role: 'utvikler',
    github_username: null,
    display_name: 'Modig Bjørk',
    assigned_at: '2026-04-05T11:15:00Z',
  },
]

const mockAllUsers: UserOption[] = [
  { navIdent: 'A123456', displayName: 'Glad Fjord', githubUsername: 'glad-fjord' },
  { navIdent: 'B654321', displayName: 'Rask Elv', githubUsername: 'rask-elv' },
  { navIdent: 'C789012', displayName: 'Stille Skog', githubUsername: 'stille-skog' },
  { navIdent: 'D345678', displayName: 'Modig Bjørk', githubUsername: 'modig-bjork' },
  { navIdent: 'E901234', displayName: 'Varm Stein', githubUsername: 'varm-stein' },
  { navIdent: 'F567890', displayName: 'Lys Bakke', githubUsername: 'lys-bakke' },
]

const meta: Meta<typeof RoleMembersSection> = {
  title: 'Components/RoleMembersSection',
  component: RoleMembersSection,
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj<typeof RoleMembersSection>

export const Default: Story = {
  args: {
    roleMembers: mockRoleMembers,
    allUsers: mockAllUsers,
  },
}

export const Empty: Story = {
  args: {
    roleMembers: [],
    allUsers: mockAllUsers,
  },
}

export const OnlyProduktleder: Story = {
  args: {
    roleMembers: mockRoleMembers.filter((m) => m.role === 'produktleder'),
    allUsers: mockAllUsers,
  },
}

export const ManyMembers: Story = {
  args: {
    roleMembers: [
      ...mockRoleMembers,
      {
        id: 5,
        nav_ident: 'E901234',
        role: 'utvikler',
        github_username: 'varm-stein',
        display_name: 'Varm Stein',
        assigned_at: '2026-04-10T08:00:00Z',
      },
      {
        id: 6,
        nav_ident: 'F567890',
        role: 'utvikler',
        github_username: 'lys-bakke',
        display_name: 'Lys Bakke',
        assigned_at: '2026-04-12T16:30:00Z',
      },
    ],
    allUsers: mockAllUsers,
  },
}
