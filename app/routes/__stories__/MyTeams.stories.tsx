import type { Meta, StoryObj } from '@storybook/react'
import {
  type DevTeamInfo,
  type DevTeamSummaryStats,
  type MyTeamsBoardSummary,
  MyTeamsPage,
} from '~/components/MyTeamsPage'

const mockTeams: DevTeamInfo[] = [
  {
    id: 1,
    name: 'Skjermbildemodernisering',
    slug: 'skjermbildemodernisering',
    section_slug: 'pensjon',
    nais_team_slugs: ['pensjon-skjerm'],
  },
  {
    id: 2,
    name: 'Starte pensjon',
    slug: 'starte-pensjon',
    section_slug: 'pensjon',
    nais_team_slugs: ['pensjon-start'],
  },
]

const mockBoards: MyTeamsBoardSummary[] = [
  {
    board: {
      id: 1,
      period_label: 'T1 2026',
      period_type: 'tertiary',
      period_start: '2026-01-01',
      period_end: '2026-04-30',
    },
    teamBasePath: '/sections/pensjon/teams/skjermbildemodernisering',
    teamName: 'Skjermbildemodernisering',
    objectives: [
      {
        objective_id: 1,
        objective_title: 'Forbedre brukeropplevelse i saksbehandlerverktøy',
        keywords: ['ux-sak'],
        dependabot_target: false,
        total_linked_deployments: 12,
        key_results: [
          { id: 10, title: 'Redusere lastetid', linked_deployments: 8, keywords: [], dependabot_target: false },
          { id: 11, title: 'Ny navigasjon', linked_deployments: 4, keywords: ['nav-ui'], dependabot_target: false },
        ],
      },
      {
        objective_id: 2,
        objective_title: 'Modernisere komponentbibliotek',
        keywords: [],
        dependabot_target: false,
        total_linked_deployments: 7,
        key_results: [
          {
            id: 20,
            title: 'Migrere til Aksel v8',
            linked_deployments: 7,
            keywords: ['aksel'],
            dependabot_target: false,
          },
        ],
      },
    ],
  },
  {
    board: {
      id: 2,
      period_label: 'T1 2026',
      period_type: 'tertiary',
      period_start: '2026-01-01',
      period_end: '2026-04-30',
    },
    teamBasePath: '/sections/pensjon/teams/starte-pensjon',
    teamName: 'Starte pensjon',
    objectives: [
      {
        objective_id: 10,
        objective_title: 'Lansere ny pensjonskalkulator',
        keywords: ['kalk-101'],
        dependabot_target: false,
        total_linked_deployments: 5,
        key_results: [{ id: 100, title: 'MVP ferdig', linked_deployments: 5, keywords: [], dependabot_target: false }],
      },
      {
        objective_id: 11,
        objective_title: 'Nødvendig forvaltning',
        keywords: [],
        dependabot_target: false,
        total_linked_deployments: 120,
        key_results: [
          {
            id: 110,
            title: 'Oppgradere avhengigheter',
            linked_deployments: 30,
            keywords: ['deps'],
            dependabot_target: false,
          },
          { id: 111, title: 'Dependabot-oppdatering', linked_deployments: 90, keywords: [], dependabot_target: true },
        ],
      },
    ],
  },
]

const mockTeamStatsHealthy: DevTeamSummaryStats = {
  total_apps: 8,
  total_deployments: 142,
  with_four_eyes: 142,
  without_four_eyes: 0,
  pending_verification: 0,
  linked_to_goal: 138,
  four_eyes_coverage: 1,
  goal_coverage: 0.97,
  four_eyes_percentage: 100,
  goal_percentage: 97,
  apps_with_issues: 0,
}

const mockTeamStatsLowCoverage: DevTeamSummaryStats = {
  total_apps: 8,
  total_deployments: 142,
  with_four_eyes: 110,
  without_four_eyes: 32,
  pending_verification: 0,
  linked_to_goal: 65,
  four_eyes_coverage: 0.77,
  goal_coverage: 0.46,
  four_eyes_percentage: 77,
  goal_percentage: 46,
  apps_with_issues: 3,
}

const mockIssueApps = [
  {
    id: 100,
    team_slug: 'pensjon-skjerm',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-skjermbilde',
    active_repo: 'navikt/pensjon-skjermbilde',
    stats: { total: 23, without_four_eyes: 4, pending_verification: 1 },
    alertCount: 2,
  },
  {
    id: 101,
    team_slug: 'pensjon-start',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-soknad',
    active_repo: 'navikt/pensjon-soknad',
    stats: { total: 12, without_four_eyes: 2, pending_verification: 0 },
    alertCount: 0,
  },
]

const mockIssueAppsWithGroup = [
  {
    id: 100,
    team_slug: 'pensjon-skjerm',
    environment_name: 'prod-fss',
    app_name: 'pensjon-psak',
    active_repo: 'navikt/pensjon-psak',
    stats: { total: 60, without_four_eyes: 3, pending_verification: 0, missing_goal_links: 5 },
    alertCount: 1,
    groupName: 'psak-og-penny',
    siblingEnvironments: ['prod-gcp'],
    groupApps: [
      { app_name: 'pensjon-psak', environment_name: 'prod-fss' },
      { app_name: 'pensjon-penny', environment_name: 'prod-gcp' },
    ],
  },
  {
    id: 101,
    team_slug: 'pensjon-start',
    environment_name: 'prod-gcp',
    app_name: 'pensjon-soknad',
    active_repo: 'navikt/pensjon-soknad',
    stats: { total: 12, without_four_eyes: 2, pending_verification: 0 },
    alertCount: 0,
  },
]

const meta: Meta<typeof MyTeamsPage> = {
  title: 'Pages/MyTeams',
  component: MyTeamsPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj<typeof MyTeamsPage>

export const MedTavler: Story = {
  name: 'Med aktive måltavler',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: mockBoards,
  },
}

export const MedTavlerOgIssues: Story = {
  name: 'Med tavler og applikasjoner som trenger oppfølging',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsLowCoverage,
    issueApps: mockIssueApps,
    boardSummaries: mockBoards,
  },
}

export const EnTavle: Story = {
  name: 'Kun én tavle (full bredde)',
  args: {
    selectedDevTeams: [mockTeams[0]],
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: [mockBoards[0]],
  },
}

export const UtenTavler: Story = {
  name: 'Uten aktive måltavler',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: [],
  },
}

export const IngenTeamValgt: Story = {
  name: 'Ingen team valgt (tomstate)',
  args: {
    selectedDevTeams: [],
    teamStats: null,
    issueApps: [],
    boardSummaries: [],
    profileId: 'ola.nordmann',
  },
}

export const AlleHarEndringsopphav: Story = {
  name: 'Endringsopphav: alle OK',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: mockBoards,
    personalMissingGoalLinks: 0,
  },
}

export const ManglerEndringsopphav: Story = {
  name: 'Endringsopphav: mangler kobling',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsLowCoverage,
    issueApps: mockIssueApps,
    boardSummaries: mockBoards,
    personalMissingGoalLinks: 47,
    profileId: 'pcmoen',
  },
}

export const IngenGitHubMapping: Story = {
  name: 'Endringsopphav: ingen GitHub-mapping',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsHealthy,
    issueApps: [],
    boardSummaries: mockBoards,
    personalMissingGoalLinks: null,
    profileId: 'ola.nordmann',
  },
}

export const MedGrupperteApps: Story = {
  name: 'Med grupperte applikasjoner',
  args: {
    selectedDevTeams: mockTeams,
    teamStats: mockTeamStatsLowCoverage,
    issueApps: mockIssueAppsWithGroup,
    boardSummaries: mockBoards,
    personalMissingGoalLinks: 12,
    profileId: 'pcmoen',
  },
}
