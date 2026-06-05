import { VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { AppCard, type AppCardData } from '../AppCard'

const meta: Meta<typeof AppCard> = {
  title: 'Components/AppCard',
  component: AppCard,
}

export default meta

type Story = StoryObj<typeof AppCard>

const baseApp: AppCardData = {
  id: 1,
  team_slug: 'pensjondeployer',
  environment_name: 'prod-fss',
  app_name: 'pensjon-pen',
  active_repo: 'navikt/pensjon-pen',
  stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
  alertCount: 0,
}

export const Default: Story = {
  args: {
    app: baseApp,
  },
}

export const StatusOK: Story = {
  name: 'Status: OK',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
    },
  },
}

export const StatusMissing: Story = {
  name: 'Status: Mangler godkjenning (flertall)',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 3, pending_verification: 0 },
    },
  },
}

export const StatusMissingSingular: Story = {
  name: 'Status: Mangler godkjenning (entall)',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 1, pending_verification: 0 },
    },
  },
}

export const StatusPending: Story = {
  name: 'Status: Venter verifisering',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 0, pending_verification: 5 },
    },
  },
}

export const StatusNoData: Story = {
  name: 'Status: Ingen data',
  args: {
    app: {
      ...baseApp,
      stats: { total: 0, without_four_eyes: 0, pending_verification: 0 },
    },
  },
}

export const WithAlerts: Story = {
  name: 'Med varsler',
  args: {
    app: {
      ...baseApp,
      alertCount: 2,
    },
  },
}

export const NoRepository: Story = {
  name: 'Uten aktivt repo',
  args: {
    app: {
      ...baseApp,
      active_repo: null,
    },
  },
}

export const HideEnvironment: Story = {
  name: 'Skjul miljø',
  args: {
    app: baseApp,
    showEnvironment: false,
  },
}

export const MultipleApps: Story = {
  name: 'Liste med flere applikasjoner',
  render: () => (
    <VStack gap="space-0">
      <AppCard
        app={{
          ...baseApp,
          id: 1,
          app_name: 'pensjon-pen',
          stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
        }}
      />
      <AppCard
        app={{
          ...baseApp,
          id: 2,
          app_name: 'pensjon-selvbetjening',
          stats: { total: 15, without_four_eyes: 2, pending_verification: 0 },
          alertCount: 1,
        }}
      />
      <AppCard
        app={{
          ...baseApp,
          id: 3,
          app_name: 'pensjon-opptjening',
          stats: { total: 8, without_four_eyes: 0, pending_verification: 3 },
        }}
      />
    </VStack>
  ),
}

export const GroupedSameNames: Story = {
  name: 'Gruppe: Samme appnavn i flere miljøer',
  args: {
    app: {
      ...baseApp,
      app_name: 'pensjon-regler',
      groupName: 'pensjon-regler',
      siblingEnvironments: ['prod-gcp'],
      groupApps: [
        { app_name: 'pensjon-regler', environment_name: 'prod-fss' },
        { app_name: 'pensjon-regler', environment_name: 'prod-gcp' },
      ],
      stats: { total: 84, without_four_eyes: 2, pending_verification: 0 },
    },
  },
}

export const GroupedDistinctNames: Story = {
  name: 'Gruppe: Ulike appnavn',
  args: {
    app: {
      ...baseApp,
      app_name: 'pensjon-psak',
      groupName: 'psak-og-penny',
      siblingEnvironments: ['prod-gcp'],
      groupApps: [
        { app_name: 'pensjon-psak', environment_name: 'prod-fss' },
        { app_name: 'pensjon-penny', environment_name: 'prod-gcp' },
      ],
      stats: { total: 120, without_four_eyes: 5, pending_verification: 1, missing_goal_links: 3 },
      alertCount: 1,
    },
  },
}

export const GroupedList: Story = {
  name: 'Liste med grupperte og ugrupperte apper',
  render: () => (
    <VStack gap="space-0">
      <AppCard
        app={{
          ...baseApp,
          id: 10,
          app_name: 'pensjon-psak',
          groupName: 'psak-og-penny',
          siblingEnvironments: ['prod-gcp'],
          groupApps: [
            { app_name: 'pensjon-psak', environment_name: 'prod-fss' },
            { app_name: 'pensjon-penny', environment_name: 'prod-gcp' },
          ],
          stats: { total: 120, without_four_eyes: 5, pending_verification: 0, missing_goal_links: 3 },
          alertCount: 1,
        }}
      />
      <AppCard
        app={{
          ...baseApp,
          id: 11,
          app_name: 'pensjon-pen',
          stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
        }}
      />
      <AppCard
        app={{
          ...baseApp,
          id: 12,
          app_name: 'pensjon-regler',
          groupName: 'pensjon-regler',
          siblingEnvironments: ['prod-gcp'],
          groupApps: [
            { app_name: 'pensjon-regler', environment_name: 'prod-fss' },
            { app_name: 'pensjon-regler', environment_name: 'prod-gcp' },
          ],
          stats: { total: 84, without_four_eyes: 0, pending_verification: 0 },
        }}
      />
    </VStack>
  ),
}

export const WithUnmappedDeployers: Story = {
  name: 'Med umappede deployere',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 0, pending_verification: 0, unmapped_deployers: 3 },
    },
  },
}

export const WithUnmappedDeployersSingular: Story = {
  name: 'Med 1 umappet deployer',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 0, pending_verification: 0, unmapped_deployers: 1 },
    },
  },
}

export const WithAllIssueTypes: Story = {
  name: 'Alle issue-typer samtidig',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 2, pending_verification: 0, missing_goal_links: 5, unmapped_deployers: 3 },
      alertCount: 1,
    },
  },
}

export const WithBaselineAction: Story = {
  name: 'Baseline: trenger baseline-godkjenning',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 0, pending_verification: 0, baseline_action_count: 1 },
    },
  },
}

export const WithBaselineAndOtherIssues: Story = {
  name: 'Baseline: kombinert med andre issues',
  args: {
    app: {
      ...baseApp,
      stats: {
        total: 42,
        without_four_eyes: 2,
        pending_verification: 1,
        baseline_action_count: 1,
        missing_goal_links: 4,
      },
      alertCount: 1,
    },
  },
}
