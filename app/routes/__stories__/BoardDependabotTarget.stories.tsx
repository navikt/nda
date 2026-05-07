import type { Meta, StoryObj } from '@storybook/react'
import { BoardDetailPage } from '~/components/BoardDetailPage'
import type { ObjectiveWithKeyResults } from '~/db/boards.server'
import type { BoardObjectiveProgress } from '~/db/dashboard-stats.server'

const meta: Meta<typeof BoardDetailPage> = {
  title: 'Routes/BoardAdmin/Måltavle',
  component: BoardDetailPage,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof BoardDetailPage>

const baseObjective: ObjectiveWithKeyResults = {
  id: 1,
  board_id: 10,
  title: 'Forbedre brukeropplevelse',
  description: 'Gjøre det enklere for brukere å finne frem',
  sort_order: 1,
  keywords: ['UX-101', 'bruker-nav'],
  dependabot_target: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  external_references: [],
  key_results: [
    {
      id: 100,
      objective_id: 1,
      title: 'Øke andel digitale søknader til 80%',
      description: null,
      sort_order: 1,
      keywords: ['digital-soknad'],
      dependabot_target: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      external_references: [],
    },
    {
      id: 101,
      objective_id: 1,
      title: 'Redusere henvendelser med 20%',
      description: 'Målt mot baseline Q4 2025',
      sort_order: 2,
      keywords: [],
      dependabot_target: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      external_references: [],
    },
  ],
}

const techObjective: ObjectiveWithKeyResults = {
  id: 2,
  board_id: 10,
  title: 'Modernisere teknisk plattform',
  description: null,
  sort_order: 2,
  keywords: ['tech-mod'],
  dependabot_target: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  external_references: [
    {
      id: 200,
      ref_type: 'jira',
      url: 'https://jira.nav.no/browse/PEN-456',
      title: 'PEN-456 Modernisering',
      objective_id: 2,
      key_result_id: null,
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  key_results: [
    {
      id: 201,
      objective_id: 2,
      title: 'Oppgradere alle avhengigheter til siste major-versjon',
      description: null,
      sort_order: 1,
      keywords: ['dep-upgrade'],
      dependabot_target: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      external_references: [],
    },
    {
      id: 202,
      objective_id: 2,
      title: 'Redusere teknisk gjeld med 30%',
      description: null,
      sort_order: 2,
      keywords: ['tech-gjeld'],
      dependabot_target: false,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      external_references: [],
    },
  ],
}

const progressData: BoardObjectiveProgress[] = [
  {
    objective_id: 1,
    objective_title: 'Forbedre brukeropplevelse',
    keywords: ['ux-101'],
    dependabot_target: false,
    total_linked_deployments: 5,
    key_results: [
      { id: 100, title: 'Øke andel digitale søknader', linked_deployments: 3, keywords: [], dependabot_target: false },
      {
        id: 101,
        title: 'Redusere henvendelser',
        linked_deployments: 2,
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
    total_linked_deployments: 12,
    key_results: [
      { id: 201, title: 'Oppgradere avhengigheter', linked_deployments: 7, keywords: [], dependabot_target: false },
      { id: 202, title: 'Dependabot-oppdatering', linked_deployments: 5, keywords: [], dependabot_target: true },
    ],
  },
]

const devTeam = { name: 'Team Pensjon' }

const baseBoard = {
  period_type: 'tertiary' as const,
  period_start: '2026-01-01',
  period_end: '2026-04-30',
  period_label: 'T1 2026',
  is_active: true,
}

function makeArgs(objectives: ObjectiveWithKeyResults[]) {
  return {
    devTeam,
    board: { ...baseBoard, objectives },
    objectiveProgress: progressData,
  }
}

export const IngenDependabotMål: Story = {
  name: 'Ingen Dependabot-mål satt',
  args: makeArgs([baseObjective, techObjective]),
}

export const DependabotMålPåObjective: Story = {
  name: 'Dependabot-mål satt på objective',
  args: makeArgs([baseObjective, { ...techObjective, dependabot_target: true }]),
}

export const DependabotMålPåKeyResult: Story = {
  name: 'Dependabot-mål satt på nøkkelresultat',
  args: makeArgs([
    baseObjective,
    {
      ...techObjective,
      key_results: [techObjective.key_results[0], { ...techObjective.key_results[1], dependabot_target: true }],
    },
  ]),
}

export const DeaktivertMedDependabotTarget: Story = {
  name: 'Deaktivert objective med Dependabot-mål',
  args: makeArgs([
    baseObjective,
    {
      ...techObjective,
      is_active: false,
      dependabot_target: true,
      key_results: techObjective.key_results.map((kr) => ({ ...kr, is_active: false })),
    },
  ]),
}

export const DeaktivertKRMedDependabotTarget: Story = {
  name: 'Deaktivert nøkkelresultat med Dependabot-mål',
  args: makeArgs([
    {
      ...techObjective,
      key_results: [
        techObjective.key_results[0],
        { ...techObjective.key_results[1], is_active: false, dependabot_target: true },
      ],
    },
  ]),
}
