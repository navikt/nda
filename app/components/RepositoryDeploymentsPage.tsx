import { BodyShort, Box, Heading, HStack, Select, VStack } from '@navikt/ds-react'
import type { ComponentProps } from 'react'
import { useSearchParams } from 'react-router'
import { groupDeploymentsBySha } from '~/lib/deployment-sha-groups'
import { DeploymentFilters, DeploymentRow, PaginationControls } from './deployments'

type DeploymentData = ComponentProps<typeof DeploymentRow>['deployment']
type FilterOption = ComponentProps<typeof DeploymentFilters>['deployerOptions'][number]
type GoalOption = ComponentProps<typeof DeploymentFilters>['goalOptions'][number]
type UserMappings = ComponentProps<typeof DeploymentRow>['userMappings']

interface RepositoryDeploymentsRepository {
  github_owner: string
  github_repo_name: string
  id: number
}

export interface RepositoryDeploymentsPageProps {
  groupBySha?: boolean
  repository: RepositoryDeploymentsRepository
  deployments: DeploymentData[]
  total: number
  page: number
  total_pages: number
  userMappings: UserMappings
  deployerOptions: FilterOption[]
  currentUserGithub: string | null
  errorReasons: Record<number, string>
  teamOptions: FilterOption[]
  teamFilterEmptyReason: 'no-user-teams' | 'no-team-members' | null
  hasUnmappedDeployers: boolean
  goalOptions: GoalOption[]
  triggerEventOptions: FilterOption[]
  workflowFileOptions: FilterOption[]
}

export function RepositoryDeploymentsPage({
  groupBySha = false,
  repository,
  deployments,
  total,
  page,
  total_pages,
  userMappings,
  deployerOptions,
  currentUserGithub,
  errorReasons,
  teamOptions,
  teamFilterEmptyReason,
  hasUnmappedDeployers,
  goalOptions,
  triggerEventOptions,
  workflowFileOptions,
}: RepositoryDeploymentsPageProps) {
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
      <div>
        <Heading size="large" level="1">
          Deployments for {repository.github_owner}/{repository.github_repo_name}
        </Heading>
        <BodyShort textColor="subtle">
          Viser repositoryets deployments til apper og miljøer, også historiske deployments.
        </BodyShort>
      </div>

      <Select
        label="Visning"
        size="small"
        value={groupBySha ? 'sha' : ''}
        onChange={(event) => updateFilter('view', event.target.value)}
      >
        <option value="">Deployments</option>
        <option value="sha">Gruppert per SHA</option>
      </Select>

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
          {groupBySha
            ? `${total} kodegruppe${total !== 1 ? 'r' : ''} funnet`
            : `${total} deployment${total !== 1 ? 's' : ''} funnet (alle apper og miljøer)`}
        </BodyShort>
      </HStack>

      {groupBySha && (
        <BodyShort textColor="subtle">
          Hver gruppe viser bare deployments som matcher filtrene. Status og godkjenning gjelder fortsatt hver
          deployment. Deployments uten SHA vises separat.
        </BodyShort>
      )}

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
        ) : groupBySha ? (
          <VStack gap="space-24">
            {groupDeploymentsBySha(deployments).map((group) => (
              <Box
                key={group.key}
                as="section"
                aria-labelledby={`sha-group-${group.deployments[0].id}`}
                borderColor="neutral-subtle"
                borderWidth="1"
                borderRadius="8"
              >
                <VStack gap="space-8">
                  <Box padding="space-16">
                    <Heading
                      size="small"
                      level="2"
                      id={`sha-group-${group.deployments[0].id}`}
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {group.sha ? `SHA ${group.sha}` : `Uten SHA – deployment ${group.deployments[0].id}`}
                    </Heading>
                    <BodyShort textColor="subtle">
                      Deployet til – {group.deployments.length} deployment{group.deployments.length !== 1 ? 's' : ''}
                    </BodyShort>
                  </Box>
                  {group.deployments.map((deployment) => (
                    <DeploymentRow
                      key={deployment.id}
                      deployment={deployment}
                      userMappings={userMappings}
                      errorReason={errorReasons[deployment.id]}
                      showEnv
                      showApp
                      searchParams={searchParams}
                    />
                  ))}
                </VStack>
              </Box>
            ))}
          </VStack>
        ) : (
          deployments.map((deployment) => (
            <DeploymentRow
              key={deployment.id}
              deployment={deployment}
              userMappings={userMappings}
              errorReason={errorReasons[deployment.id]}
              showEnv
              showApp
              searchParams={searchParams}
            />
          ))
        )}
      </div>

      <PaginationControls page={page} totalPages={total_pages} onPageChange={goToPage} />
    </VStack>
  )
}
