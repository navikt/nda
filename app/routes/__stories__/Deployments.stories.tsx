import type { Meta, StoryObj } from '@storybook/react'
import type { ComponentProps } from 'react'
import { AppDeploymentsPage } from '~/components/AppDeploymentsPage'
import type { DeploymentFilters, DeploymentRow } from '~/components/deployments'
import type { UserLookupMap } from '~/lib/user-display'
import { getWorkflowTriggerLabel } from '~/lib/workflow-trigger-label'

type AppDeploymentsPageProps = ComponentProps<typeof AppDeploymentsPage>
type DeploymentData = ComponentProps<typeof DeploymentRow>['deployment']
type FilterOption = ComponentProps<typeof DeploymentFilters>['deployerOptions'][number]
type GoalOption = ComponentProps<typeof DeploymentFilters>['goalOptions'][number]

const userMappings: UserLookupMap = {
  'glad-fjord': { display_name: 'Glad Fjord', nav_ident: 'Z990001' },
  'rask-elv': { display_name: 'Rask Elv', nav_ident: 'Z990002' },
  'modig-bjork': { display_name: 'Modig Bjørk', nav_ident: 'Z990003' },
  'klok-skog': { display_name: 'Klok Skog', nav_ident: 'Z990004' },
  'stolt-vind': { display_name: 'Stolt Vind', nav_ident: 'Z990005' },
}

const teamLabelBySlug: Record<string, string> = {
  pensjondeployer: 'Pensjon Deployer',
  pensjonsamhandling: 'Pensjon Samhandling',
}

const app: AppDeploymentsPageProps['app'] = {
  id: 1,
  team_slug: 'pensjondeployer',
  environment_name: 'prod-fss',
  app_name: 'pensjon-pen',
  is_active: true,
  default_branch: 'main',
  default_branch_synced_at: new Date('2026-02-01T09:00:00Z'),
  audit_start_year: 2024,
  test_requirement: 'integration_tests',
  slack_channel_id: null,
  slack_notifications_enabled: false,
  reminder_enabled: false,
  reminder_time: null,
  reminder_days: null,
  reminder_last_sent_at: null,
  slack_notifications_enabled_at: null,
  slack_deploy_channel_id: null,
  slack_deploy_notify_enabled: false,
  slack_deploy_notify_enabled_at: null,
  not_found_in_nais_at: null,
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2026-02-01T09:00:00Z'),
}

const baseDeployment: DeploymentData = {
  id: 1,
  created_at: '2026-02-08T10:30:00Z',
  title: 'feat: Forbedre deployoversikt',
  deployer_username: 'glad-fjord',
  commit_sha: 'abc123def456ghi789',
  detected_github_owner: 'navikt',
  detected_github_repo_name: 'pensjon-pen',
  github_pr_number: 42,
  github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/42',
  github_pr_data: {
    creator: { username: 'rask-elv' },
    merged_by: { username: 'modig-bjork' },
  },
  workflow_trigger_config: {
    workflowPath: '.github/workflows/deploy.yml',
    triggerEvent: 'workflow_dispatch',
  },
  four_eyes_status: 'approved',
  has_goal_link: true,
  team_slug: 'pensjondeployer',
  environment_name: 'prod-fss',
  app_name: 'pensjon-pen',
}

const fixtureDeployments: DeploymentData[] = [
  baseDeployment,
  {
    ...baseDeployment,
    id: 2,
    created_at: '2026-02-07T15:00:00Z',
    title: 'fix: Rette feil i deployjobb',
    deployer_username: 'stille-vann',
    commit_sha: 'def456abc789ghi012',
    github_pr_number: null,
    github_pr_url: null,
    github_pr_data: null,
    workflow_trigger_config: {
      workflowPath: '.github/workflows/release.yml',
      triggerEvent: 'push',
    },
    four_eyes_status: 'direct_push',
    has_goal_link: false,
  },
  {
    ...baseDeployment,
    id: 3,
    created_at: '2026-02-06T09:00:00Z',
    title: 'chore: Oppdatere avhengigheter',
    deployer_username: 'klok-skog',
    commit_sha: 'ghi789jkl012mno345',
    github_pr_number: 108,
    github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/108',
    github_pr_data: {
      creator: { username: 'klok-skog' },
      merged_by: { username: 'stolt-vind' },
    },
    workflow_trigger_config: {
      workflowPath: '.github/workflows/verify.yml',
      triggerEvent: 'pull_request',
    },
    four_eyes_status: 'pending',
    has_goal_link: true,
  },
  {
    ...baseDeployment,
    id: 4,
    created_at: '2026-02-05T08:15:00Z',
    title: 'Manuelt godkjent deployment',
    deployer_username: 'modig-bjork',
    commit_sha: 'jkl012mno345pqr678',
    github_pr_number: 121,
    github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/121',
    github_pr_data: {
      creator: { username: 'rask-elv' },
      merged_by: { username: 'modig-bjork' },
    },
    workflow_trigger_config: {
      workflowPath: '.github/workflows/deploy.yml',
      triggerEvent: 'workflow_dispatch',
    },
    four_eyes_status: 'manually_approved',
    has_goal_link: true,
  },
  {
    ...baseDeployment,
    id: 5,
    created_at: '2026-02-04T11:45:00Z',
    title: 'Deployment med feil',
    deployer_username: 'rask-elv',
    commit_sha: 'mno345pqr678stu901',
    github_pr_number: 144,
    github_pr_url: 'https://github.com/navikt/pensjon-pen/pull/144',
    github_pr_data: {
      creator: { username: 'glad-fjord' },
      merged_by: { username: 'stolt-vind' },
    },
    workflow_trigger_config: {
      workflowPath: '.github/workflows/deploy.yml',
      triggerEvent: 'workflow_dispatch',
    },
    four_eyes_status: 'error',
    has_goal_link: false,
  },
]

const goalOptions: GoalOption[] = [
  {
    id: 1,
    title: 'Bedre deployflyt',
    dev_team_name: 'Pensjon Deployer',
    period_label: '2026 H1',
    type: 'objective',
  },
  {
    id: 2,
    title: 'Verifisere koblinger',
    dev_team_name: 'Pensjon Deployer',
    period_label: '2026 H1',
    type: 'key_result',
    parent_objective_id: 1,
  },
]

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value)
}

function getDeployerOptions(): FilterOption[] {
  return [...new Set(fixtureDeployments.map((deployment) => deployment.deployer_username).filter(isNonEmptyString))]
    .map((username) => ({
      value: username,
      label: userMappings[username]?.display_name ?? username,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'no'))
}

function getTeamOptions(): FilterOption[] {
  return [...new Set(fixtureDeployments.map((deployment) => deployment.team_slug))]
    .map((slug) => ({
      value: slug,
      label: teamLabelBySlug[slug] ?? slug,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'no'))
}

function getTriggerEventOptions(): FilterOption[] {
  return [
    ...new Set(
      fixtureDeployments
        .map((deployment) => deployment.workflow_trigger_config?.triggerEvent)
        .filter(Boolean) as string[],
    ),
  ]
    .map((value) => ({
      value,
      label: getWorkflowTriggerLabel(value),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'no'))
}

function getWorkflowFileOptions(): FilterOption[] {
  return [
    ...new Set(
      fixtureDeployments
        .map((deployment) => deployment.workflow_trigger_config?.workflowPath)
        .filter(Boolean) as string[],
    ),
  ]
    .map((value) => ({
      value,
      label: value.split('/').pop() ?? value,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'no'))
}

const baseArgs: AppDeploymentsPageProps = {
  app,
  deployments: fixtureDeployments.slice(0, 3),
  total: 42,
  page: 1,
  total_pages: 3,
  userMappings,
  deployerOptions: getDeployerOptions(),
  currentUserGithub: 'glad-fjord',
  hasGroup: false,
  showGroup: false,
  appGroup: null,
  groupSiblings: [],
  errorReasons: {},
  teamOptions: getTeamOptions(),
  teamFilterEmptyReason: null,
  hasUnmappedDeployers: true,
  goalOptions,
  triggerEventOptions: getTriggerEventOptions(),
  workflowFileOptions: getWorkflowFileOptions(),
}

const meta: Meta<typeof AppDeploymentsPage> = {
  title: 'Pages/Deployments',
  component: AppDeploymentsPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof AppDeploymentsPage>

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

export const SinglePage: Story = {
  name: 'Én side',
  args: {
    ...baseArgs,
    total: 3,
    total_pages: 1,
  },
}

export const MiddlePage: Story = {
  name: 'Midterste side',
  args: {
    ...baseArgs,
    total: 100,
    page: 3,
    total_pages: 5,
  },
}

export const MixedStatuses: Story = {
  name: 'Blandet status',
  args: {
    ...baseArgs,
    deployments: fixtureDeployments,
    total: 5,
    total_pages: 1,
    errorReasons: {
      5: 'GitHub-verifisering feilet fordi PR-data manglet ved siste kjøring.',
    },
  },
}
