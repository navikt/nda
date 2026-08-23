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
  group: { id: 1, name: 'Pensjon-appen' },
  siblings: [
    {
      id: 2,
      team_slug: mockApp.team_slug,
      environment_name: 'dev-gcp',
      app_name: mockApp.app_name,
    },
    {
      id: 3,
      team_slug: mockApp.team_slug,
      environment_name: 'prod-gcp',
      app_name: mockApp.app_name,
    },
  ],
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
  isAdmin = false,
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
        element: <AppDetailPage loaderData={mergedLoaderData} actionData={actionData} isAdmin={isAdmin} />,
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
    isAdmin: false,
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
    isAdmin: true,
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
    isAdmin: true,
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
      group: null,
      siblings: [],
      devTeams: [],
    },
    isAdmin: true,
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
    isAdmin: false,
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
    isAdmin: false,
  },
  render: (args) => renderAppDetailStory(args),
}
