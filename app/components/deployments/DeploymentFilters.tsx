import { Box, HStack, Select, TextField, VStack } from '@navikt/ds-react'
import { Form } from 'react-router'
import { TIME_PERIOD_OPTIONS } from '~/lib/time-periods'

interface FilterOption {
  value: string
  label: string
}

interface GoalOption {
  id: number
  title: string
  dev_team_name: string | null
  period_label: string | null
}

interface DeploymentFiltersProps {
  currentPeriod: string
  currentStatus: string
  currentMethod: string
  currentGoal: string
  currentDeployer: string
  currentSha: string
  currentTeam: string
  currentApp?: string
  deployerOptions: FilterOption[]
  teamOptions: FilterOption[]
  goalOptions: GoalOption[]
  appOptions?: FilterOption[]
  hasUnmappedDeployers: boolean
  hasNonMemberDeployers?: boolean
  currentUserGithub: string | null
  onFilterChange: (key: string, value: string) => void
}

export function DeploymentFilters({
  currentPeriod,
  currentStatus,
  currentMethod,
  currentGoal,
  currentDeployer,
  currentSha,
  currentTeam,
  currentApp,
  deployerOptions,
  teamOptions,
  goalOptions,
  appOptions,
  hasUnmappedDeployers,
  hasNonMemberDeployers,
  currentUserGithub,
  onFilterChange,
}: DeploymentFiltersProps) {
  return (
    <Box padding="space-20" borderRadius="8" background="sunken">
      <Form method="get">
        <VStack gap="space-16">
          <HStack gap="space-16" wrap>
            <Select
              label="Tidsperiode"
              size="small"
              value={currentPeriod}
              onChange={(e) => onFilterChange('period', e.target.value)}
            >
              {TIME_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>

            <Select
              label="Status"
              size="small"
              value={currentStatus}
              onChange={(e) => onFilterChange('status', e.target.value)}
            >
              <option value="">Alle</option>
              <option value="approved">Godkjent</option>
              <option value="manually_approved">Manuelt godkjent</option>
              <option value="not_approved">Ikke godkjent</option>
              <option value="pending">Venter</option>
              <option value="legacy">Legacy</option>
              <option value="legacy_pending">Legacy (venter)</option>
              <option value="baseline">Baseline</option>
              <option value="pending_baseline">Baseline (venter)</option>
              <option value="baseline_action">Baseline (trenger handling)</option>
              <option value="error">Feil</option>
              <option value="unknown">Ukjent</option>
            </Select>

            <Select
              label="Metode"
              size="small"
              value={currentMethod}
              onChange={(e) => onFilterChange('method', e.target.value)}
            >
              <option value="">Alle</option>
              <option value="pr">Pull Request</option>
              <option value="direct_push">Direct Push</option>
              <option value="legacy">Legacy</option>
            </Select>

            <Select
              label="Endringsopphav"
              size="small"
              value={currentGoal}
              onChange={(e) => onFilterChange('goal', e.target.value)}
            >
              <option value="">Alle</option>
              <option value="missing">Mangler kobling</option>
              <option value="linked">Alle koblede</option>
              {goalOptions.length > 0 &&
                (() => {
                  const groups = new Map<string, GoalOption[]>()
                  for (const obj of goalOptions) {
                    const groupKey = [obj.dev_team_name, obj.period_label].filter(Boolean).join(' – ') || 'Mål'
                    const existing = groups.get(groupKey) ?? []
                    existing.push(obj)
                    groups.set(groupKey, existing)
                  }
                  return Array.from(groups.entries()).map(([groupLabel, options]) => (
                    <optgroup key={groupLabel} label={groupLabel}>
                      {options.map((obj) => (
                        <option key={obj.id} value={`obj:${obj.id}`}>
                          {obj.title}
                        </option>
                      ))}
                    </optgroup>
                  ))
                })()}
            </Select>

            <Select
              label="Deployer"
              size="small"
              value={currentDeployer}
              onChange={(e) => onFilterChange('deployer', e.target.value)}
            >
              <option value="">Alle</option>
              {currentUserGithub && <option value={currentUserGithub}>Meg</option>}
              {(hasUnmappedDeployers || currentDeployer === '__unmapped__') && (
                <option value="__unmapped__">Manglende mapping</option>
              )}
              {(hasNonMemberDeployers || currentDeployer === '__non_member__') && (
                <option value="__non_member__">Fra andre (ikke-medlemmer)</option>
              )}
              {deployerOptions
                .filter((opt) => opt.value !== currentUserGithub)
                .map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
            </Select>

            {teamOptions.length > 0 && (
              <Select
                label="Team"
                size="small"
                value={currentTeam}
                onChange={(e) => onFilterChange('team', e.target.value)}
              >
                <option value="">Alle</option>
                {teamOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            )}

            {appOptions && appOptions.length > 0 && (
              <Select
                label="Applikasjon"
                size="small"
                value={currentApp ?? ''}
                onChange={(e) => onFilterChange('app', e.target.value)}
              >
                <option value="">Alle</option>
                {appOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            )}

            <TextField
              label="Commit SHA"
              size="small"
              value={currentSha}
              onChange={(e) => onFilterChange('sha', e.target.value)}
              placeholder="Søk..."
            />
          </HStack>
        </VStack>
      </Form>
    </Box>
  )
}
