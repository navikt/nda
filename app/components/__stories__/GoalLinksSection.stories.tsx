import type { Meta, StoryObj } from '@storybook/react'
import type { DeploymentGoalLinkWithDetails } from '~/db/deployment-goal-links.server'
import { type AvailableBoard, GoalLinksSection } from '../GoalLinksSection'

const meta: Meta<typeof GoalLinksSection> = {
  title: 'Components/GoalLinksSection',
  component: GoalLinksSection,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '700px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof GoalLinksSection>

const mockBoards: AvailableBoard[] = [
  {
    id: 1,
    period_label: 'T1 2026',
    dev_team_name: 'Team Pensjon',
    objectives: [
      {
        id: 10,
        title: 'Forbedre brukeropplevelse for selvbetjening',
        key_results: [
          { id: 100, title: 'Øke andel digitale søknader til 80%' },
          { id: 101, title: 'Redusere henvendelser til kontaktsenter med 20%' },
        ],
      },
      {
        id: 11,
        title: 'Modernisere teknisk plattform',
        key_results: [
          { id: 110, title: 'Migrere 3 applikasjoner til Nais' },
          { id: 111, title: 'Redusere teknisk gjeld med 30%' },
        ],
      },
    ],
  },
  {
    id: 2,
    period_label: 'T2 2026',
    dev_team_name: 'Team Pensjon',
    objectives: [
      {
        id: 20,
        title: 'Automatisere behandling av vedtak',
        key_results: [{ id: 200, title: 'Automatiseringsgrad på 60%' }],
      },
    ],
  },
]

const sectionBoards: AvailableBoard[] = [
  {
    id: 3,
    period_label: 'T1 2026',
    dev_team_name: 'Team Uføre',
    objectives: [
      {
        id: 30,
        title: 'Forbedre saksbehandlingsflyt',
        key_results: [{ id: 300, title: 'Gjennomsnittlig saksbehandlingstid under 14 dager' }],
      },
    ],
  },
]

const goalLinkWithObjective: DeploymentGoalLinkWithDetails = {
  id: 1,
  deployment_id: 42,
  objective_id: 10,
  key_result_id: null,
  external_url: null,
  external_url_title: null,
  comment: null,
  link_method: 'manual',
  linked_by: 'A123456',
  is_active: true,
  created_at: '2026-04-01T10:00:00Z',
  objective_title: 'Forbedre brukeropplevelse for selvbetjening',
  key_result_title: null,
  board_period_label: 'T1 2026',
  board_period_type: 'tertiary',
  dev_team_slug: 'starte-pensjon',
  section_slug: 'pensjon',
  objective_is_active: true,
  key_result_is_active: null,
}

const goalLinkWithKeyResult: DeploymentGoalLinkWithDetails = {
  id: 2,
  deployment_id: 42,
  objective_id: 10,
  key_result_id: 100,
  external_url: 'https://jira.nav.no/browse/PEN-1234',
  external_url_title: 'PEN-1234',
  comment: 'Implementerer ny søknadsflyt for alderspensjon',
  link_method: 'manual',
  linked_by: 'A123456',
  is_active: true,
  created_at: '2026-04-02T10:00:00Z',
  objective_title: 'Forbedre brukeropplevelse for selvbetjening',
  key_result_title: 'Øke andel digitale søknader til 80%',
  board_period_label: 'T1 2026',
  board_period_type: 'tertiary',
  dev_team_slug: 'starte-pensjon',
  section_slug: 'pensjon',
  objective_is_active: true,
  key_result_is_active: true,
}

const autoLinkedFromCommit: DeploymentGoalLinkWithDetails = {
  id: 3,
  deployment_id: 42,
  objective_id: 11,
  key_result_id: 110,
  external_url: null,
  external_url_title: null,
  comment: null,
  link_method: 'commit_keyword',
  linked_by: null,
  is_active: true,
  created_at: '2026-04-03T10:00:00Z',
  objective_title: 'Modernisere teknisk plattform',
  key_result_title: 'Migrere 3 applikasjoner til Nais',
  board_period_label: 'T1 2026',
  board_period_type: 'tertiary',
  dev_team_slug: 'starte-pensjon',
  section_slug: 'pensjon',
  objective_is_active: true,
  key_result_is_active: true,
}

const externalOnlyLink: DeploymentGoalLinkWithDetails = {
  id: 4,
  deployment_id: 42,
  objective_id: null,
  key_result_id: null,
  external_url: 'https://jira.nav.no/browse/PEN-999',
  external_url_title: 'PEN-999',
  comment: 'Eldre kobling som ikke teller som koblet',
  link_method: 'manual',
  linked_by: 'A123456',
  is_active: true,
  created_at: '2026-03-01T10:00:00Z',
  objective_title: null,
  key_result_title: null,
  board_period_label: null,
  board_period_type: null,
  dev_team_slug: null,
  section_slug: null,
  objective_is_active: null,
  key_result_is_active: null,
}

const deactivatedGoalLink: DeploymentGoalLinkWithDetails = {
  id: 5,
  deployment_id: 42,
  objective_id: 10,
  key_result_id: null,
  external_url: null,
  external_url_title: null,
  comment: null,
  link_method: 'manual',
  linked_by: 'A123456',
  is_active: true,
  created_at: '2026-02-01T10:00:00Z',
  objective_title: 'Forbedre brukeropplevelse for selvbetjening',
  key_result_title: null,
  board_period_label: 'T1 2026',
  board_period_type: 'tertiary',
  dev_team_slug: 'starte-pensjon',
  section_slug: 'pensjon',
  objective_is_active: false,
  key_result_is_active: null,
}

export const TomTilstand: Story = {
  name: 'Ingen koblinger',
  args: {
    goalLinks: [],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}

export const KobletTilMaal: Story = {
  name: 'Koblet til mål',
  args: {
    goalLinks: [goalLinkWithObjective],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}

export const KobletMedLenkeOgKommentar: Story = {
  name: 'Koblet til nøkkelresultat med lenke og kommentar',
  args: {
    goalLinks: [goalLinkWithKeyResult],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}

export const AutoKobletFraCommit: Story = {
  name: 'Auto-koblet via commit-nøkkelord',
  args: {
    goalLinks: [autoLinkedFromCommit],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}

export const KunEksternLenke: Story = {
  name: 'Kun ekstern lenke (teller IKKE som koblet)',
  args: {
    goalLinks: [externalOnlyLink],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}

export const FlereKoblinger: Story = {
  name: 'Flere koblinger (blanding)',
  args: {
    goalLinks: [goalLinkWithKeyResult, autoLinkedFromCommit, externalOnlyLink],
    availableBoards: mockBoards,
    sectionBoards: sectionBoards,
  },
}

export const DeaktivertMaal: Story = {
  name: 'Deaktivert mål',
  args: {
    goalLinks: [deactivatedGoalLink],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}

export const MedSeksjonstavler: Story = {
  name: 'Med seksjonstavler (tabs vises)',
  args: {
    goalLinks: [],
    availableBoards: mockBoards,
    sectionBoards: sectionBoards,
  },
}

export const IngenTilgjengeligeTavler: Story = {
  name: 'Ingen tilgjengelige tavler',
  args: {
    goalLinks: [],
    availableBoards: [],
    sectionBoards: [],
  },
}

const dependabotAutoLink: DeploymentGoalLinkWithDetails = {
  id: 6,
  deployment_id: 42,
  objective_id: 11,
  key_result_id: 110,
  external_url: null,
  external_url_title: null,
  comment: null,
  link_method: 'dependabot_auto',
  linked_by: null,
  is_active: true,
  created_at: '2026-04-05T08:00:00Z',
  objective_title: 'Modernisere teknisk plattform',
  key_result_title: 'Migrere 3 applikasjoner til Nais',
  board_period_label: 'T1 2026',
  board_period_type: 'tertiary',
  dev_team_slug: 'starte-pensjon',
  section_slug: 'pensjon',
  objective_is_active: true,
  key_result_is_active: true,
}

export const AutoKobletFraDependabot: Story = {
  name: 'Auto-koblet via Dependabot',
  args: {
    goalLinks: [dependabotAutoLink],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}

export const BlandingMedDependabot: Story = {
  name: 'Blanding med Dependabot og commit-nøkkelord',
  args: {
    goalLinks: [goalLinkWithKeyResult, autoLinkedFromCommit, dependabotAutoLink],
    availableBoards: mockBoards,
    sectionBoards: [],
  },
}
