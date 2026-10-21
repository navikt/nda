import { BodyShort, Box, Button, Heading, HStack, VStack } from '@navikt/ds-react'
import type { ComponentProps } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  DEPLOYMENT_REPOSITORY_STATUS_LABELS,
  type DeploymentRepositoryStatus,
  type DeploymentRepositorySummary,
  parseDeploymentRepositoryStatus,
} from '~/lib/deployment-repository-status'
import type { DeploymentView } from '~/lib/deployment-view'
import { DeploymentFilters, DeploymentRow, PaginationControls } from './deployments'
import { DeploymentViewLinks } from './deployments/DeploymentViewLinks'

type DeploymentData = ComponentProps<typeof DeploymentRow>['deployment']
type FilterOption = ComponentProps<typeof DeploymentFilters>['deployerOptions'][number]
type GoalOption = ComponentProps<typeof DeploymentFilters>['goalOptions'][number]
type UserMappings = ComponentProps<typeof DeploymentRow>['userMappings']

interface MonitoredApplication {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  is_active: boolean
  default_branch: string | null
  default_branch_synced_at: string | Date | null
  test_requirement: 'none' | 'unit_tests' | 'integration_tests'
  slack_channel_id: string | null
  slack_notifications_enabled: boolean
  reminder_enabled: boolean
  reminder_time: string | null
  reminder_days: string[] | null
  reminder_last_sent_at: string | Date | null
  slack_notifications_enabled_at: string | Date | null
  slack_deploy_channel_id: string | null
  slack_deploy_notify_enabled: boolean
  slack_deploy_notify_enabled_at: string | Date | null
  not_found_in_nais_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

interface MonorepoInfo {
  github_owner: string
  github_repo_name: string
  repository_id: number | null
}

export interface AppDeploymentsPageProps {
  view?: DeploymentView
  repositorySummaries?: Record<number, DeploymentRepositorySummary>
  repositoryCounts?: Record<DeploymentRepositoryStatus, number> | null
  app: MonitoredApplication
  deployments: DeploymentData[]
  total: number
  page: number
  per_page: number
  total_pages: number
  userMappings: UserMappings
  deployerOptions: FilterOption[]
  currentUserGithub: string | null
  hasMonorepoSiblings: boolean
  showAllEnvironments: boolean
  monorepo: MonorepoInfo | null
  errorReasons: Record<number, string>
  teamOptions: FilterOption[]
  teamFilterEmptyReason: 'no-user-teams' | 'no-team-members' | null
  hasUnmappedDeployers: boolean
  goalOptions: GoalOption[]
  triggerEventOptions: FilterOption[]
  workflowFileOptions: FilterOption[]
}

export function AppDeploymentsPage({
  view = 'application',
  repositorySummaries = {},
  repositoryCounts,
  app,
  deployments,
  total,
  page,
  per_page,
  total_pages,
  userMappings,
  deployerOptions,
  currentUserGithub,
  hasMonorepoSiblings,
  showAllEnvironments,
  monorepo,
  errorReasons,
  teamOptions,
  teamFilterEmptyReason,
  hasUnmappedDeployers,
  goalOptions,
  triggerEventOptions,
  workflowFileOptions,
}: AppDeploymentsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const pathname = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/deployments`
  const viewParams = new URLSearchParams(searchParams)
  viewParams.set('page', '1')

  const currentStatus =
    view === 'repository'
      ? (parseDeploymentRepositoryStatus(searchParams.get('repositoryStatus')) ?? '')
      : searchParams.get('status') || ''
  const currentMethod = searchParams.get('method') || ''
  const currentGoal = searchParams.get('goal') || ''
  const currentDeployer = searchParams.get('deployer') || ''
  const currentSha = searchParams.get('sha') || ''
  const currentTrigger = searchParams.get('trigger') || ''
  const currentWorkflowFile = searchParams.get('workflowFile') || ''
  const currentPeriod = searchParams.get('period') || 'last-week'
  const teamParam = searchParams.get('team') || ''
  const currentTeam = teamParam === 'mine' && !teamOptions.some((o) => o.value === 'mine') ? '' : teamParam

  const updateFilter = (key: string, value: string) => {
    if (key === 'status' && view === 'repository') key = 'repositoryStatus'
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    newParams.set('page', '1')
    setSearchParams(newParams)
  }

  const goToPage = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', String(newPage))
    setSearchParams(newParams)
  }

  const changePerPage = (newPerPage: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('perPage', String(newPerPage))
    newParams.set('page', '1')
    setSearchParams(newParams)
  }

  return (
    <VStack gap="space-32">
      <Heading level="1" size="large">
        {view === 'repository' ? 'Deployments – repositoryvurdering' : 'Deployments – appbasert vurdering'}
      </Heading>
      <DeploymentViewLinks pathname={pathname} searchParams={viewParams} currentView={view} />
      {monorepo && !showAllEnvironments && (
        <Box padding="space-16" borderRadius="8" background="neutral-soft">
          <HStack gap="space-8" align="center" justify="space-between" wrap>
            <BodyShort size="small">
              Denne appen er del av monorepoet{' '}
              <strong>
                {monorepo.github_owner}/{monorepo.github_repo_name}
              </strong>
            </BodyShort>
            {monorepo.repository_id !== null ? (
              <Button
                as={Link}
                to={`/repository/${monorepo.github_owner}/${monorepo.github_repo_name}/deployments?repositoryId=${monorepo.repository_id}`}
                variant="tertiary"
                size="xsmall"
              >
                Se alle deployments for repoet
              </Button>
            ) : (
              hasMonorepoSiblings && (
                <Button variant="tertiary" size="xsmall" onClick={() => updateFilter('monorepo', 'true')}>
                  Vis alle miljøer
                </Button>
              )
            )}
          </HStack>
        </Box>
      )}

      <DeploymentFilters
        statusOptions={
          view === 'repository'
            ? Object.entries(DEPLOYMENT_REPOSITORY_STATUS_LABELS).map(([value, label]) => ({ value, label }))
            : undefined
        }
        statusLabel={view === 'repository' ? 'Kodedekning' : undefined}
        methodLabel={view === 'repository' ? 'Metode (appbasert)' : undefined}
        currentPeriod={currentPeriod}
        currentStatus={currentStatus}
        currentMethod={currentMethod}
        currentGoal={currentGoal}
        currentDeployer={currentDeployer}
        currentSha={currentSha}
        currentTeam={currentTeam}
        currentTrigger={currentTrigger}
        currentWorkflowFile={currentWorkflowFile}
        deployerOptions={deployerOptions}
        teamOptions={teamOptions}
        goalOptions={goalOptions}
        triggerEventOptions={triggerEventOptions}
        workflowFileOptions={workflowFileOptions}
        hasUnmappedDeployers={hasUnmappedDeployers}
        currentUserGithub={currentUserGithub}
        onFilterChange={updateFilter}
      />
      {view === 'repository' && repositoryCounts && (
        <BodyShort size="small" textColor="subtle">
          Kodedekning før statusfilter:{' '}
          {Object.entries(DEPLOYMENT_REPOSITORY_STATUS_LABELS)
            .map(([status, label]) => `${label}: ${repositoryCounts[status as DeploymentRepositoryStatus]}`)
            .join(' · ')}
        </BodyShort>
      )}

      <HStack justify="space-between" align="center" wrap>
        <BodyShort textColor="subtle">
          {total} deployment{total !== 1 ? 's' : ''} funnet
          {showAllEnvironments && ' (alle miljøer)'}
        </BodyShort>
        {hasMonorepoSiblings && (monorepo?.repository_id == null || showAllEnvironments) && (
          <Button
            variant={showAllEnvironments ? 'secondary' : 'tertiary'}
            size="small"
            onClick={() => updateFilter('monorepo', showAllEnvironments ? '' : 'true')}
          >
            {showAllEnvironments ? 'Vis kun dette miljøet' : 'Vis alle miljøer'}
          </Button>
        )}
      </HStack>

      <div>
        {deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>
              {teamFilterEmptyReason === 'no-user-teams'
                ? 'Du har ikke valgt noen utviklingsteam under dine preferanser, så «Mine team» gir ingen treff.'
                : teamFilterEmptyReason === 'no-team-members'
                  ? 'Det valgte teamet har ingen medlemmer med GitHub-brukernavn registrert, så filteret gir ingen treff.'
                  : 'Ingen deployments funnet med valgte filtre.'}
            </BodyShort>
          </Box>
        ) : (
          deployments.map((deployment) => (
            <DeploymentRow
              key={deployment.id}
              deployment={deployment}
              userMappings={userMappings}
              errorReason={errorReasons[deployment.id]}
              showEnv={showAllEnvironments}
              currentEnv={app.environment_name}
              searchParams={searchParams}
              showRepositoryView
              currentView={view}
              repositorySummary={view === 'repository' ? repositorySummaries[deployment.id] : undefined}
            />
          ))
        )}
      </div>

      <PaginationControls
        page={page}
        totalPages={total_pages}
        onPageChange={goToPage}
        perPage={per_page}
        onPerPageChange={changePerPage}
      />
    </VStack>
  )
}
