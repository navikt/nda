import { BodyShort, Box, HStack, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { type ComponentProps, useMemo, useState } from 'react'
import { DeploymentFilters, DeploymentRow, PaginationControls } from '~/components/deployments'
import type { UserLookupMap } from '~/lib/user-display'
import { getWorkflowTriggerLabel } from '~/lib/workflow-trigger-label'

type DeploymentData = ComponentProps<typeof DeploymentRow>['deployment']
type FilterOption = ComponentProps<typeof DeploymentFilters>['deployerOptions'][number]
type GoalOption = ComponentProps<typeof DeploymentFilters>['goalOptions'][number]

interface DeploymentsStoryPageProps {
  deployments: DeploymentData[]
  total: number
  page: number
  totalPages: number
  errorReasons?: Record<number, string>
  showGroup?: boolean
  currentEnv?: string
}

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

function DeploymentsStoryPage({
  deployments,
  total,
  page: initialPage,
  totalPages,
  errorReasons = {},
  showGroup = false,
  currentEnv = 'prod-fss',
}: DeploymentsStoryPageProps) {
  const [page, setPage] = useState(initialPage)
  const [filters, setFilters] = useState({
    period: 'last-week',
    status: '',
    method: '',
    goal: '',
    deployer: '',
    sha: '',
    team: '',
    trigger: '',
    workflowFile: '',
  })

  const searchParams = useMemo(() => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value)
    }
    params.set('page', String(page))
    return params
  }, [filters, page])

  const deployerOptions = useMemo(() => getDeployerOptions(), [])
  const teamOptions = useMemo(() => getTeamOptions(), [])
  const triggerEventOptions = useMemo(() => getTriggerEventOptions(), [])
  const workflowFileOptions = useMemo(() => getWorkflowFileOptions(), [])

  const updateFilter = (key: string, value: string) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }))
    setPage(1)
  }

  return (
    <VStack gap="space-32">
      <DeploymentFilters
        currentPeriod={filters.period}
        currentStatus={filters.status}
        currentMethod={filters.method}
        currentGoal={filters.goal}
        currentDeployer={filters.deployer}
        currentSha={filters.sha}
        currentTeam={filters.team}
        currentTrigger={filters.trigger}
        currentWorkflowFile={filters.workflowFile}
        deployerOptions={deployerOptions}
        teamOptions={teamOptions}
        goalOptions={goalOptions}
        triggerEventOptions={triggerEventOptions}
        workflowFileOptions={workflowFileOptions}
        hasUnmappedDeployers
        currentUserGithub="glad-fjord"
        onFilterChange={updateFilter}
      />

      <HStack justify="space-between" align="center" wrap>
        <BodyShort textColor="subtle">
          {total} deployment{total !== 1 ? 's' : ''} funnet
          {showGroup && ' (alle miljøer)'}
        </BodyShort>
      </HStack>

      <div>
        {deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen deployments funnet med valgte filtre.</BodyShort>
          </Box>
        ) : (
          deployments.map((deployment) => (
            <DeploymentRow
              key={deployment.id}
              deployment={deployment}
              userMappings={userMappings}
              errorReason={errorReasons[deployment.id]}
              showEnv={showGroup}
              currentEnv={currentEnv}
              searchParams={searchParams}
            />
          ))
        )}
      </div>

      <PaginationControls page={page} totalPages={totalPages} onPageChange={setPage} />
    </VStack>
  )
}

const meta: Meta<typeof DeploymentsStoryPage> = {
  title: 'Pages/Deployments',
  component: DeploymentsStoryPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '1000px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeploymentsStoryPage>

export const Default: Story = {
  args: {
    deployments: fixtureDeployments.slice(0, 3),
    total: 42,
    page: 1,
    totalPages: 3,
  },
}

export const Empty: Story = {
  name: 'Ingen resultater',
  args: {
    deployments: [],
    total: 0,
    page: 1,
    totalPages: 0,
  },
}

export const SinglePage: Story = {
  name: 'Én side',
  args: {
    deployments: fixtureDeployments.slice(0, 3),
    total: 3,
    page: 1,
    totalPages: 1,
  },
}

export const MiddlePage: Story = {
  name: 'Midterste side',
  args: {
    deployments: fixtureDeployments.slice(0, 3),
    total: 100,
    page: 3,
    totalPages: 5,
  },
}

export const MixedStatuses: Story = {
  name: 'Blandet status',
  args: {
    deployments: fixtureDeployments,
    total: 5,
    page: 1,
    totalPages: 1,
    errorReasons: {
      5: 'GitHub-verifisering feilet fordi PR-data manglet ved siste kjøring.',
    },
  },
}
