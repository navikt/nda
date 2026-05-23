import type { Meta, StoryObj } from '@storybook/react'
import {
  type SectionOption,
  type SectionRoleAssignmentDisplay,
  SectionRolesTable,
} from '~/components/SectionRolesTable'

const mockSections: SectionOption[] = [
  { id: 1, name: 'Seksjon Arbeid' },
  { id: 2, name: 'Seksjon Helse' },
  { id: 3, name: 'Seksjon Pensjon' },
]

const mockAssignments: SectionRoleAssignmentDisplay[] = [
  {
    id: 1,
    nav_ident: 'Z990001',
    section_id: 1,
    role: 'teknologileder',
    assigned_by: 'Z990002',
    assigned_at: '2026-03-15T10:00:00Z',
  },
  {
    id: 2,
    nav_ident: 'Z990003',
    section_id: 1,
    role: 'seksjonsleder',
    assigned_by: 'Z990002',
    assigned_at: '2026-03-16T08:30:00Z',
  },
  {
    id: 3,
    nav_ident: 'Z990004',
    section_id: 2,
    role: 'leveranseleder',
    assigned_by: 'Z990001',
    assigned_at: '2026-04-01T14:00:00Z',
  },
  {
    id: 4,
    nav_ident: 'Z990005',
    section_id: 3,
    role: 'teknologileder',
    assigned_by: 'Z990001',
    assigned_at: '2026-04-10T09:15:00Z',
  },
]

const mockDisplayNameMap: Record<string, string> = {
  Z990001: 'Glad Fjord',
  Z990003: 'Stille Skog',
  Z990004: 'Modig Bjørk',
  Z990005: 'Varm Stein',
}

const meta: Meta<typeof SectionRolesTable> = {
  title: 'Components/SectionRolesTable',
  component: SectionRolesTable,
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj<typeof SectionRolesTable>

export const Default: Story = {
  args: {
    sections: mockSections,
    assignments: mockAssignments,
    displayNameMap: mockDisplayNameMap,
  },
}

export const Empty: Story = {
  args: {
    sections: mockSections,
    assignments: [],
    displayNameMap: {},
  },
}

export const SingleSection: Story = {
  args: {
    sections: [mockSections[0]],
    assignments: mockAssignments.filter((a) => a.section_id === 1),
    displayNameMap: mockDisplayNameMap,
  },
}
