import type { Meta, StoryObj } from '@storybook/react'
import { RepositoryCodeDeliveriesPage } from '~/components/RepositoryCodeDeliveriesPage'

const meta: Meta<typeof RepositoryCodeDeliveriesPage> = {
  title: 'Features/RepositoryAdmin/RepositoryCodeDeliveriesPage',
  component: RepositoryCodeDeliveriesPage,
  args: {
    status: 'all',
    followUpCounts: { approved: 1, not_approved: 0, incomplete: 0, no_changes: 1 },
    filteredTotal: 2,
    canApprove: true,
  },
}
export default meta
type Story = StoryObj<typeof RepositoryCodeDeliveriesPage>

const repository = { id: 5, githubOwner: 'navikt', githubRepoName: 'glad-fjord' }

export const MedData: Story = {
  args: {
    repository,
    tracking: { enabled: true, since: '2026-10-01T08:00:00.000Z' },
    overview: {
      deliveryCount: 2,
      linkedDeploymentCount: 5,
      awaitingDeploymentCount: 1,
      unresolvedByReason: { ancestry_behind: 1, source_unauthorized: 1 },
    },
    historyReadiness: {
      applications: [
        {
          team_slug: 'team-fjord',
          environment_name: 'prod-gcp',
          app_name: 'glad-fjord-api',
          is_active: true,
          initial_nais_history_synced_at: '2026-10-01T08:00:00.000Z',
          deployment_count: 14,
          repository_deployment_count: 8,
          unassigned_deployment_count: 4,
          other_repository_deployment_count: 2,
          repository_deployments_missing_sha: 0,
        },
        {
          team_slug: 'team-fjord',
          environment_name: 'prod-gcp',
          app_name: 'glad-fjord-web',
          is_active: false,
          initial_nais_history_synced_at: null,
          deployment_count: 5,
          repository_deployment_count: 1,
          unassigned_deployment_count: 4,
          other_repository_deployment_count: 0,
          repository_deployments_missing_sha: 1,
        },
      ],
      repositoryDeploymentCount: 9,
      repositoryDeploymentsMissingShaCount: 1,
      repositoryDeploymentsWithoutKnownAppLinkCount: 0,
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
        assessment: {
          state: 'complete',
          totalCommits: 2,
          listedCommits: 2,
          summary: { covered: 2, notCovered: 0, unknown: 0 },
        },
        pullRequestNumbers: [42],
        followUp: { status: 'approved', covered: 2, needsApproval: 0, unknown: 0 },
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
        assessment: {
          state: 'unavailable',
          totalCommits: null,
          listedCommits: 0,
          summary: { covered: 0, notCovered: 0, unknown: 0 },
        },
        pullRequestNumbers: [],
        followUp: { status: 'no_changes', covered: 0, needsApproval: 0, unknown: 0 },
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
    followUpCounts: { approved: 0, not_approved: 0, incomplete: 0, no_changes: 0 },
    filteredTotal: 0,
    repository,
    tracking: { enabled: false, since: null },
    overview: { deliveryCount: 0, linkedDeploymentCount: 0, awaitingDeploymentCount: 0, unresolvedByReason: {} },
    historyReadiness: {
      applications: [],
      repositoryDeploymentCount: 0,
      repositoryDeploymentsMissingShaCount: 0,
      repositoryDeploymentsWithoutKnownAppLinkCount: 0,
    },
    deliveries: [],
    unresolved: [],
    page: 1,
    totalPages: 1,
    onSortChange: () => {},
    onPageChange: () => {},
  },
}

export const BlandetOppfolging: Story = {
  args: {
    ...MedData.args,
    overview: { deliveryCount: 4, linkedDeploymentCount: 4, awaitingDeploymentCount: 0, unresolvedByReason: {} },
    followUpCounts: { approved: 1, not_approved: 1, incomplete: 1, no_changes: 1 },
    filteredTotal: 4,
    deliveries: [
      {
        id: 4,
        base_sha: '3'.repeat(40),
        head_sha: '4'.repeat(40),
        created_at: '2026-10-04T10:00:00Z',
        first_deployed_at: '2026-10-04T10:00:00Z',
        is_anchor: false,
        deployment_count: 1,
        app_names: ['glad-fjord-api'],
        assessment: {
          state: 'complete',
          totalCommits: 2,
          listedCommits: 2,
          summary: { covered: 0, notCovered: 2, unknown: 0 },
        },
        followUp: { status: 'not_approved', covered: 0, needsApproval: 2, unknown: 0 },
        pullRequestNumbers: [],
      },
      {
        id: 5,
        base_sha: '4'.repeat(40),
        head_sha: '5'.repeat(40),
        created_at: '2026-10-05T10:00:00Z',
        first_deployed_at: '2026-10-05T10:00:00Z',
        is_anchor: false,
        deployment_count: 1,
        app_names: ['glad-fjord-web'],
        assessment: {
          state: 'unavailable',
          totalCommits: null,
          listedCommits: 0,
          summary: { covered: 0, notCovered: 0, unknown: 0 },
        },
        followUp: { status: 'incomplete', covered: 0, needsApproval: 0, unknown: 0 },
        pullRequestNumbers: [],
      },
      ...(MedData.args?.deliveries ?? []),
    ],
  },
}
