import type { Meta, StoryObj } from '@storybook/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  type AppDetailLatestSyncJob,
  type AppDetailLoaderData,
  AppDetailPage,
  type AppDetailPageProps,
} from '~/components/AppDetailPage'
import {
  mockAlert,
  mockApp,
  mockAuditReport,
  mockDeploymentStats,
  mockPendingRepository,
  mockRepository,
} from './mock-data'

const baseLoaderData: AppDetailLoaderData = {
  app: {
    id: mockApp.id,
    team_slug: mockApp.team_slug,
    environment_name: mockApp.environment_name,
    app_name: mockApp.app_name,
    default_branch: 'main',
    is_active: true,
    not_found_in_nais_at: null,
  },
  canDeactivate: false,
  canReactivate: false,
  repositories: [mockRepository],
  activeRepo: mockRepository,
  pendingRepos: [],
  historicalRepos: [
    {
      ...mockRepository,
      id: 3,
      github_repo_name: 'pensjon-pen-legacy',
      status: 'historical',
      redirects_to_owner: 'navikt',
      redirects_to_repo: 'pensjon-pen',
    },
  ],
  deploymentStats: {
    ...mockDeploymentStats,
    baseline_action_count: 0,
  },
  alerts: [],
  auditReports: [mockAuditReport],
  monorepo: null,
  devTeams: [
    {
      id: 1,
      name: 'Pensjon Oppfølging',
      slug: 'pensjon-oppfolging',
      section_slug: 'pensjon',
    },
  ],
  latestSyncJob: {
    status: 'completed',
    started_at: '2026-02-08T10:00:00Z',
    completed_at: '2026-02-08T10:00:15Z',
    created_at: '2026-02-08T10:00:00Z',
  } satisfies AppDetailLatestSyncJob,
  verificationProgress: {
    total: 42,
    pending: 2,
  },
  verifyLimitPerCycle: 10,
  syncIntervalMs: 300000,
}

const meta: Meta<typeof AppDetailPage> = {
  title: 'Pages/AppDetail',
  component: AppDetailPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1200px' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    router: { skip: true },
  },
}

export default meta

type Story = StoryObj<typeof meta>

type StoryProps = Partial<AppDetailPageProps> & {
  loaderData?: Partial<AppDetailLoaderData>
  initialEntry?: string
}

function renderAppDetailStory({
  loaderData,
  actionData = null,
  canAccessAdmin = false,
  initialEntry = '/team/pensjondeployer/env/prod-fss/app/pensjon-pen?period=last-week',
}: StoryProps) {
  const mergedLoaderData: AppDetailLoaderData = {
    ...baseLoaderData,
    ...loaderData,
    app: {
      ...baseLoaderData.app,
      ...loaderData?.app,
    },
    deploymentStats: {
      ...baseLoaderData.deploymentStats,
      ...loaderData?.deploymentStats,
    },
    verificationProgress: {
      ...baseLoaderData.verificationProgress,
      ...loaderData?.verificationProgress,
    },
  }

  const router = createMemoryRouter(
    [
      {
        path: '/team/:team/env/:env/app/:app',
        element: (
          <AppDetailPage loaderData={mergedLoaderData} actionData={actionData} canAccessAdmin={canAccessAdmin} />
        ),
      },
    ],
    {
      initialEntries: [initialEntry],
    },
  )

  return <RouterProvider router={router} />
}

export const Default: Story = {
  args: {
    loaderData: baseLoaderData,
    canAccessAdmin: false,
  },
  render: (args) => renderAppDetailStory(args),
}

export const AdminView: Story = {
  name: 'Som admin',
  args: {
    loaderData: {
      ...baseLoaderData,
      pendingRepos: [mockPendingRepository],
      repositories: [mockRepository, mockPendingRepository, ...baseLoaderData.historicalRepos],
    },
    canAccessAdmin: true,
  },
  render: (args) => renderAppDetailStory(args),
}

export const WithAlerts: Story = {
  name: 'Med varsler',
  args: {
    loaderData: {
      ...baseLoaderData,
      alerts: [mockAlert],
      pendingRepos: [mockPendingRepository],
      repositories: [mockRepository, mockPendingRepository, ...baseLoaderData.historicalRepos],
    },
    canAccessAdmin: true,
  },
  render: (args) => renderAppDetailStory(args),
}

export const NoRepository: Story = {
  name: 'Ingen repository',
  args: {
    loaderData: {
      ...baseLoaderData,
      repositories: [mockPendingRepository],
      activeRepo: undefined,
      pendingRepos: [mockPendingRepository],
      historicalRepos: [],
      deploymentStats: { ...baseLoaderData.deploymentStats, total: 0, last_deployment: null, last_deployment_id: null },
      auditReports: [],
      devTeams: [],
    },
    canAccessAdmin: true,
  },
  render: (args) => renderAppDetailStory(args),
}

export const DevEnvironment: Story = {
  name: 'Dev-miljø (ingen rapport)',
  args: {
    loaderData: {
      ...baseLoaderData,
      app: { ...baseLoaderData.app, environment_name: 'dev-fss' },
      auditReports: [],
    },
    canAccessAdmin: false,
  },
  render: (args) => renderAppDetailStory(args),
}

export const WithBaselineWarning: Story = {
  name: 'Baseline: deployment venter baseline-godkjenning',
  args: {
    loaderData: {
      ...baseLoaderData,
      deploymentStats: { ...baseLoaderData.deploymentStats, baseline_action_count: 1 },
    },
    canAccessAdmin: false,
  },
  render: (args) => renderAppDetailStory(args),
}

export const InMonorepo: Story = {
  name: 'Del av monorepo',
  args: {
    loaderData: {
      ...baseLoaderData,
      monorepo: {
        github_owner: 'navikt',
        github_repo_name: 'pensjon-monorepo',
        siblings: [
          { id: 20, app_name: 'pensjon-utbetaling', team_slug: 'pensjonutbetaling', environment_name: 'prod-fss' },
          { id: 21, app_name: 'pensjon-saksbehandling', team_slug: 'pensjonsak', environment_name: 'prod-gcp' },
        ],
        base_branch_mismatch: false,
        audit_year_mismatch: false,
      },
    },
    canAccessAdmin: false,
  },
  render: (args) => renderAppDetailStory(args),
}

export const InMonorepoWithMismatch: Story = {
  name: 'Monorepo med avvik i base branch/revisjonsår',
  args: {
    loaderData: {
      ...baseLoaderData,
      monorepo: {
        github_owner: 'navikt',
        github_repo_name: 'pensjon-monorepo',
        siblings: [
          { id: 20, app_name: 'pensjon-utbetaling', team_slug: 'pensjonutbetaling', environment_name: 'prod-fss' },
        ],
        base_branch_mismatch: true,
        audit_year_mismatch: true,
      },
    },
    canAccessAdmin: false,
  },
  render: (args) => renderAppDetailStory(args),
}
