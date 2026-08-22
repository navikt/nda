import { BodyShort, Box, Button, HStack, VStack } from '@navikt/ds-react'
import type { ComponentProps } from 'react'
import { Link, useSearchParams } from 'react-router'
import { DeploymentFilters, DeploymentRow, PaginationControls } from './deployments'

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
  audit_start_year: number | null
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
  application_group_id: number | null
  not_found_in_nais_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

interface ApplicationGroup {
  id: number
  name: string
  created_at: string | Date
}

interface GroupSibling {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
}

export interface AppDeploymentsPageProps {
  app: MonitoredApplication
  deployments: DeploymentData[]
  total: number
  page: number
  total_pages: number
  userMappings: UserMappings
  deployerOptions: FilterOption[]
  currentUserGithub: string | null
  hasGroup: boolean
  showGroup: boolean
  appGroup: ApplicationGroup | null
  groupSiblings: GroupSibling[]
  errorReasons: Record<number, string>
  teamOptions: FilterOption[]
  teamFilterEmptyReason: 'no-user-teams' | 'no-team-members' | null
  hasUnmappedDeployers: boolean
  goalOptions: GoalOption[]
  triggerEventOptions: FilterOption[]
  workflowFileOptions: FilterOption[]
}

export function AppDeploymentsPage({
  app,
  deployments,
  total,
  page,
  total_pages,
  userMappings,
  deployerOptions,
  currentUserGithub,
  hasGroup,
  showGroup,
  appGroup,
  groupSiblings,
  errorReasons,
  teamOptions,
  teamFilterEmptyReason,
  hasUnmappedDeployers,
  goalOptions,
  triggerEventOptions,
  workflowFileOptions,
}: AppDeploymentsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams()

  const currentStatus = searchParams.get('status') || ''
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

  return (
    <VStack gap="space-32">
      {appGroup && !showGroup && (
        <Box padding="space-16" borderRadius="8" background="neutral-soft">
          <HStack gap="space-8" align="center" justify="space-between" wrap>
            <BodyShort size="small">
              Denne appen er del av gruppen <strong>{appGroup.name}</strong>
              {groupSiblings.length > 0 && (
                <>
                  {' — '}
                  {groupSiblings.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ', '}
                      <Link to={`/team/${s.team_slug}/env/${s.environment_name}/app/${s.app_name}/deployments`}>
                        {s.app_name} ({s.environment_name})
                      </Link>
                    </span>
                  ))}
                </>
              )}
            </BodyShort>
            {hasGroup && (
              <Button variant="tertiary" size="xsmall" onClick={() => updateFilter('group', 'true')}>
                Vis alle miljøer
              </Button>
            )}
          </HStack>
        </Box>
      )}

      <DeploymentFilters
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

      <HStack justify="space-between" align="center" wrap>
        <BodyShort textColor="subtle">
          {total} deployment{total !== 1 ? 's' : ''} funnet
          {showGroup && ' (alle miljøer)'}
        </BodyShort>
        {hasGroup && (
          <Button
            variant={showGroup ? 'secondary' : 'tertiary'}
            size="small"
            onClick={() => updateFilter('group', showGroup ? '' : 'true')}
          >
            {showGroup ? 'Vis kun dette miljøet' : 'Vis alle miljøer'}
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
              showEnv={showGroup}
              currentEnv={app.environment_name}
              searchParams={searchParams}
            />
          ))
        )}
      </div>

      <PaginationControls page={page} totalPages={total_pages} onPageChange={goToPage} />
    </VStack>
  )
}
