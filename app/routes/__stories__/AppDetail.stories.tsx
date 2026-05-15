import type { Meta, StoryObj } from '@storybook/react'
import { AppDetailPage } from '~/components/AppDetailPage'
import {
  mockAlert,
  mockApp,
  mockAuditReport,
  mockDeploymentStats,
  mockPendingRepository,
  mockRepository,
} from './mock-data'

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
}

export default meta

type Story = StoryObj<typeof AppDetailPage>

const baseApp = {
  id: mockApp.id,
  team_slug: mockApp.team_slug,
  environment_name: mockApp.environment_name,
  app_name: mockApp.app_name,
  default_branch: 'main',
}

export const Default: Story = {
  args: {
    app: baseApp,
    activeRepo: mockRepository,
    pendingRepos: [],
    deploymentStats: mockDeploymentStats,
    alerts: [],
    auditReports: [mockAuditReport],
    isAdmin: false,
  },
}

export const AdminView: Story = {
  name: 'Som admin',
  args: {
    app: baseApp,
    activeRepo: mockRepository,
    pendingRepos: [mockPendingRepository],
    deploymentStats: mockDeploymentStats,
    alerts: [],
    auditReports: [mockAuditReport],
    isAdmin: true,
  },
}

export const WithAlerts: Story = {
  name: 'Med varsler',
  args: {
    app: baseApp,
    activeRepo: mockRepository,
    pendingRepos: [],
    deploymentStats: mockDeploymentStats,
    alerts: [mockAlert],
    auditReports: [],
    isAdmin: true,
  },
}

export const NoRepository: Story = {
  name: 'Ingen repository',
  args: {
    app: baseApp,
    activeRepo: null,
    pendingRepos: [mockPendingRepository],
    deploymentStats: { ...mockDeploymentStats, total: 0 },
    alerts: [],
    auditReports: [],
    isAdmin: true,
  },
}

export const DevEnvironment: Story = {
  name: 'Dev-miljø (ingen rapport)',
  args: {
    app: { ...baseApp, environment_name: 'dev-fss' },
    activeRepo: mockRepository,
    pendingRepos: [],
    deploymentStats: mockDeploymentStats,
    alerts: [],
    auditReports: [],
    isAdmin: false,
  },
}
