import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'
import type { DeploymentFilters, DeploymentRow } from '~/components/deployments'
import { RepositoryDeploymentsPage } from '~/components/RepositoryDeploymentsPage'
import type { UserLookupMap } from '~/lib/user-display'

type RepositoryDeploymentsPageProps = ComponentProps<typeof RepositoryDeploymentsPage>
type DeploymentData = ComponentProps<typeof DeploymentRow>['deployment']
type FilterOption = ComponentProps<typeof DeploymentFilters>['deployerOptions'][number]
type GoalOption = ComponentProps<typeof DeploymentFilters>['goalOptions'][number]

const userMappings: UserLookupMap = {
  'glad-fjord': { display_name: 'Glad Fjord', nav_ident: 'Z990001' },
  'rask-elv': { display_name: 'Rask Elv', nav_ident: 'Z990002' },
}

const repository: RepositoryDeploymentsPageProps['repository'] = {
  id: 94,
  github_owner: 'navikt',
  github_repo_name: 'mulighetsrommet',
}

const baseDeployment: DeploymentData = {
  id: 1,
  created_at: '2026-02-08T10:30:00Z',
  title: 'feat: Ny funksjonalitet',
  deployer_username: 'glad-fjord',
  commit_sha: 'abc123def456ghi789',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'mulighetsrommet',
  github_pr_number: 42,
  github_pr_url: 'https://github.com/navikt/mulighetsrommet/pull/42',
  github_pr_data: {
    creator: { username: 'rask-elv' },
    merged_by: { username: 'glad-fjord' },
  },
  workflow_trigger_config: {
    workflowPath: '.github/workflows/deploy.yml',
    triggerEvent: 'workflow_dispatch',
  },
  four_eyes_status: 'approved',
  has_goal_link: true,
  team_slug: 'team-mulighetsrommet',
  environment_name: 'prod-gcp',
  app_name: 'mulighetsrommet-arena-adapter',
}

const fixtureDeployments: DeploymentData[] = [
  baseDeployment,
  {
    ...baseDeployment,
    id: 2,
    created_at: '2026-02-07T15:00:00Z',
    title: 'fix: Rette feil i deployjobb',
    deployer_username: 'rask-elv',
    app_name: 'mulighetsrommet-api',
    environment_name: 'dev-gcp',
    four_eyes_status: 'direct_push',
    has_goal_link: false,
  },
  {
    ...baseDeployment,
    id: 3,
    created_at: '2026-02-06T09:00:00Z',
    title: 'chore: Oppdatere avhengigheter',
    deployer_username: 'glad-fjord',
    app_name: 'mulighetsrommet-veileder-flate',
    environment_name: 'prod-gcp',
    four_eyes_status: 'pending',
    has_goal_link: true,
  },
]

const goalOptions: GoalOption[] = []

const deployerOptions: FilterOption[] = [
  { value: 'glad-fjord', label: 'Glad Fjord' },
  { value: 'rask-elv', label: 'Rask Elv' },
]

const teamOptions: FilterOption[] = [{ value: 'team-mulighetsrommet', label: 'Team Mulighetsrommet' }]

const baseArgs: RepositoryDeploymentsPageProps = {
  repository,
  deployments: fixtureDeployments,
  total: 3,
  page: 1,
  total_pages: 1,
  userMappings,
  deployerOptions,
  currentUserGithub: 'glad-fjord',
  errorReasons: {},
  teamOptions,
  teamFilterEmptyReason: null,
  hasUnmappedDeployers: false,
  goalOptions,
  triggerEventOptions: [],
  workflowFileOptions: [],
}

const meta: Meta<typeof RepositoryDeploymentsPage> = {
  title: 'Pages/RepositoryDeployments',
  component: RepositoryDeploymentsPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof RepositoryDeploymentsPage>

export const Default: Story = {
  args: baseArgs,
}

export const Empty: Story = {
  name: 'Ingen resultater',
  args: {
    ...baseArgs,
    deployments: [],
    total: 0,
    page: 1,
    total_pages: 0,
  },
}

export const GroupedBySha: Story = {
  name: 'Gruppert per SHA med ulike statuser',
  args: {
    ...baseArgs,
    groupBySha: true,
    total: 2,
    deployments: [
      { ...baseDeployment, commit_sha: 'a'.repeat(40) },
      { ...fixtureDeployments[1], commit_sha: 'a'.repeat(40) },
      { ...fixtureDeployments[2], commit_sha: null },
    ],
  },
}

export const EmptyShaView: Story = {
  args: {
    ...baseArgs,
    groupBySha: true,
    deployments: [],
    total: 0,
    total_pages: 0,
  },
}

export const StoredComparisonRanges: Story = {
  name: 'Lagrede intervaller og manglende intervall',
  args: {
    ...baseArgs,
    groupBySha: true,
    total: 1,
    comparisonRanges: {
      1: { baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40) },
      2: { baseSha: 'c'.repeat(40), headSha: 'a'.repeat(40) },
    },
    deployments: fixtureDeployments.map((deployment) => ({ ...deployment, commit_sha: 'a'.repeat(40) })),
  },
}

export const ShaStatusSummary: Story = {
  name: 'Statusoppsummering for viste deployments',
  args: {
    ...baseArgs,
    groupBySha: true,
    total: 1,
    deployments: [
      { ...baseDeployment, commit_sha: 'a'.repeat(40) },
      { ...fixtureDeployments[1], commit_sha: 'a'.repeat(40) },
      { ...fixtureDeployments[2], commit_sha: 'a'.repeat(40) },
    ],
  },
}
