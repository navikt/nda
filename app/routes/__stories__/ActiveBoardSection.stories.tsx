import type { Meta, StoryObj } from '@storybook/react'
import { ActiveBoardSection, type ActiveBoardSectionProps } from '~/components/ActiveBoardSection'

const meta = {
  title: 'Components/ActiveBoardSection',
  component: ActiveBoardSection,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ActiveBoardSection>

export default meta
type Story = StoryObj<typeof meta>

const baseBoard: ActiveBoardSectionProps['board'] = {
  id: 1,
  period_label: 'T1 2026',
  period_type: 'tertiary',
  period_start: '2026-01-01',
  period_end: '2026-04-30',
}

export const MedKodeordOgDependabot: Story = {
  args: {
    board: baseBoard,
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    objectives: [
      {
        objective_id: 1,
        objective_title: 'Forbedre brukeropplevelse',
        keywords: ['ux-101'],
        dependabot_target: false,
        total_linked_deployments: 34,
        key_results: [
          {
            id: 100,
            title: 'Øke andel digitale søknader',
            linked_deployments: 21,
            keywords: ['digital-soknad'],
            dependabot_target: false,
          },
          {
            id: 101,
            title: 'Redusere henvendelser til kundesenter',
            linked_deployments: 13,
            keywords: ['hen-42'],
            dependabot_target: false,
          },
        ],
      },
      {
        objective_id: 2,
        objective_title: 'Nødvendig forvaltning',
        keywords: ['sp-bau'],
        dependabot_target: false,
        total_linked_deployments: 557,
        key_results: [
          {
            id: 201,
            title: 'Oppgradere avhengigheter',
            linked_deployments: 245,
            keywords: [],
            dependabot_target: false,
          },
          {
            id: 202,
            title: 'Dependabot-oppdatering',
            linked_deployments: 312,
            keywords: [],
            dependabot_target: true,
          },
        ],
      },
    ],
  },
}

export const UtenKodeord: Story = {
  args: {
    board: baseBoard,
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    objectives: [
      {
        objective_id: 1,
        objective_title: 'Teknisk modernisering',
        keywords: [],
        dependabot_target: false,
        total_linked_deployments: 40,
        key_results: [
          {
            id: 100,
            title: 'Migrere til ny plattform',
            linked_deployments: 25,
            keywords: [],
            dependabot_target: false,
          },
          {
            id: 101,
            title: 'Fjerne legacy-kode',
            linked_deployments: 15,
            keywords: [],
            dependabot_target: false,
          },
        ],
      },
    ],
  },
}

export const DependabotPaaMaal: Story = {
  name: 'Dependabot-mål på mål (ikke nøkkelresultat)',
  args: {
    board: baseBoard,
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    objectives: [
      {
        objective_id: 1,
        objective_title: 'Nødvendig forvaltning',
        keywords: ['sp-bau'],
        dependabot_target: true,
        total_linked_deployments: 800,
        key_results: [],
      },
      {
        objective_id: 2,
        objective_title: 'Ny funksjonalitet',
        keywords: ['ny-funk'],
        dependabot_target: false,
        total_linked_deployments: 45,
        key_results: [
          {
            id: 201,
            title: 'Implementere selvbetjening',
            linked_deployments: 45,
            keywords: ['selvbetjening'],
            dependabot_target: false,
          },
        ],
      },
    ],
  },
}

export const IngenMaal: Story = {
  name: 'Ingen mål opprettet',
  args: {
    board: baseBoard,
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    objectives: [],
  },
}
