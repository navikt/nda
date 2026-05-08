import type { Meta, StoryObj } from '@storybook/react'
import { UserRolesDisplay } from '~/components/UserRolesDisplay'

const meta: Meta<typeof UserRolesDisplay> = {
  title: 'Components/UserRolesDisplay',
  component: UserRolesDisplay,
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj<typeof UserRolesDisplay>

export const SectionAndTeamRoles: Story = {
  args: {
    userRoles: {
      sectionRoles: [{ role: 'teknologileder', sectionName: 'Seksjon Arbeid', sectionSlug: 'arbeid' }],
      teamRoles: [
        { role: 'produktleder', teamName: 'Team Dagpenger', teamSlug: 'dagpenger', sectionSlug: 'arbeid' },
        { role: 'utvikler', teamName: 'Team AAP', teamSlug: 'aap', sectionSlug: 'arbeid' },
      ],
    },
  },
}

export const OnlySectionRoles: Story = {
  args: {
    userRoles: {
      sectionRoles: [
        { role: 'seksjonsleder', sectionName: 'Seksjon Helse', sectionSlug: 'helse' },
        { role: 'leveranseleder', sectionName: 'Seksjon Pensjon', sectionSlug: 'pensjon' },
      ],
      teamRoles: [],
    },
  },
}

export const OnlyTeamRoles: Story = {
  args: {
    userRoles: {
      sectionRoles: [],
      teamRoles: [
        { role: 'utvikler', teamName: 'Team Sykepenger', teamSlug: 'sykepenger', sectionSlug: 'helse' },
        { role: 'utvikler', teamName: 'Team Foreldrepenger', teamSlug: 'foreldrepenger', sectionSlug: 'helse' },
      ],
    },
  },
}

export const NoRoles: Story = {
  args: {
    userRoles: {
      sectionRoles: [],
      teamRoles: [],
    },
  },
}

export const AllRoleTypes: Story = {
  args: {
    userRoles: {
      sectionRoles: [
        { role: 'teknologileder', sectionName: 'Seksjon Arbeid', sectionSlug: 'arbeid' },
        { role: 'seksjonsleder', sectionName: 'Seksjon Helse', sectionSlug: 'helse' },
        { role: 'leveranseleder', sectionName: 'Seksjon Pensjon', sectionSlug: 'pensjon' },
      ],
      teamRoles: [
        { role: 'produktleder', teamName: 'Team Dagpenger', teamSlug: 'dagpenger', sectionSlug: 'arbeid' },
        { role: 'utvikler', teamName: 'Team AAP', teamSlug: 'aap', sectionSlug: 'arbeid' },
      ],
    },
  },
}
