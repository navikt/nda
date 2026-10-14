import type { Meta, StoryObj } from '@storybook/react'
import { RepositoryCodeDeliveriesPage } from '~/components/RepositoryCodeDeliveriesPage'

const meta: Meta<typeof RepositoryCodeDeliveriesPage> = {
  title: 'Features/RepositoryAdmin/RepositoryCodeDeliveriesPage',
  component: RepositoryCodeDeliveriesPage,
}
export default meta
type Story = StoryObj<typeof RepositoryCodeDeliveriesPage>

const repository = { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' }

export const MedData: Story = {
  args: {
    repository,
    tracking: { enabled: true, since: '2026-10-01T08:00:00.000Z' },
    overview: {
      deliveryCount: 3,
      linkedDeploymentCount: 5,
      awaitingDeploymentCount: 1,
      unresolvedByReason: { ancestry_behind: 1, source_unauthorized: 1 },
    },
    deliveries: [
      {
        id: 3,
        base_sha: '2'.repeat(40),
        head_sha: '3'.repeat(40),
        created_at: '2026-10-03T10:00:00.000Z',
        first_deployed_at: '2026-10-03T10:00:00.000Z',
        is_anchor: false,
        deployment_count: 2,
        app_names: ['glad-fjord-api', 'glad-fjord-web'],
      },
      {
        id: 1,
        base_sha: '1'.repeat(40),
        head_sha: '1'.repeat(40),
        created_at: '2026-10-01T10:00:00.000Z',
        first_deployed_at: '2026-10-01T10:00:00.000Z',
        is_anchor: true,
        deployment_count: 1,
        app_names: ['glad-fjord-api'],
      },
    ],
    unresolved: [
      {
        deployment_id: 11,
        team_slug: 'team-fjord',
        environment_name: 'prod-gcp',
        app_name: 'glad-fjord-api',
        commit_sha: '4'.repeat(40),
        detected_github_owner: 'navikt',
        detected_github_repo_name: 'glad-fjord',
        deployed_at: '2026-10-02T10:00:00.000Z',
        reason: 'ancestry_behind',
        first_seen_at: '2026-10-02T10:05:00.000Z',
        last_attempt_at: '2026-10-02T10:05:00.000Z',
      },
      {
        deployment_id: 12,
        team_slug: 'team-fjord',
        environment_name: 'prod-gcp',
        app_name: 'glad-fjord-web',
        commit_sha: '5'.repeat(40),
        detected_github_owner: null,
        detected_github_repo_name: null,
        deployed_at: '2026-10-04T10:00:00.000Z',
        reason: 'source_unauthorized',
        first_seen_at: '2026-10-04T10:05:00.000Z',
        last_attempt_at: '2026-10-04T10:05:00.000Z',
      },
    ],
    page: 1,
    totalPages: 1,
    onSortChange: () => {},
    onPageChange: () => {},
  },
}

export const Av: Story = {
  args: {
    repository,
    tracking: { enabled: false, since: null },
    overview: { deliveryCount: 0, linkedDeploymentCount: 0, awaitingDeploymentCount: 0, unresolvedByReason: {} },
    deliveries: [],
    unresolved: [],
    page: 1,
    totalPages: 1,
    onSortChange: () => {},
    onPageChange: () => {},
  },
}
