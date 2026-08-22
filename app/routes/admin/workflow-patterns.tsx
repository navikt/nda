import { ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import {
  BodyLong,
  BodyShort,
  Box,
  Detail,
  Heading,
  HStack,
  ReadMore,
  Select,
  Switch,
  Table,
  Tag,
  VStack,
} from '@navikt/ds-react'
import { Link, useLoaderData, useSearchParams } from 'react-router'
import { ExternalLink } from '~/components/ExternalLink'
import { pool } from '~/db/connection.server'
import { requireAdmin } from '~/lib/auth.server'
import { getDateRangeForPeriod, TIME_PERIOD_OPTIONS, type TimePeriod } from '~/lib/time-periods'
import {
  GITHUB_TRIGGER_DOCS_URL,
  getAllKnownWorkflowTriggerEvents,
  getWorkflowTriggerDescription,
  getWorkflowTriggerLabel,
} from '~/lib/workflow-trigger-label'
import type { Route } from './+types/workflow-patterns'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Workflow-mønstre (alle apper) - Admin' }]
}

const PROD_ENVIRONMENTS = ['prod-fss', 'prod-gcp']
const MANUAL_TRIGGER_EVENTS = ['workflow_dispatch', 'repository_dispatch']

interface TriggerBreakdownRow {
  team_slug: string
  app_name: string
  environment_name: string
  trigger_event: string
  via_pr: boolean
  count: string
}

interface AppTriggerSummary {
  teamSlug: string
  appName: string
  environmentName: string
  total: number
  byTrigger: Record<string, number>
  viaPr: number
  viaDirectPush: number
  unknownCount: number
  unknownPercent: number
  manualCount: number
  manualPercent: number
  isProd: boolean
  flagged: boolean
  lowConfidence: boolean
}

const MIN_KNOWN_SAMPLE_SIZE = 5
const HIGH_UNKNOWN_THRESHOLD_PERCENT = 50

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const url = new URL(request.url)
  const period = (url.searchParams.get('period') || 'last-tertial') as TimePeriod
  const envFilter = url.searchParams.get('env') || 'all'
  const triggerFilter = url.searchParams.get('trigger') || 'all'

  const range = getDateRangeForPeriod(period)

  const baseParams: Array<Date | string | string[]> = []
  const baseConditions: string[] = []
  if (range) {
    baseParams.push(range.startDate, range.endDate)
    baseConditions.push(`created_at >= $${baseParams.length - 1} AND created_at <= $${baseParams.length}`)
  }
  if (envFilter === 'prod') {
    baseParams.push(PROD_ENVIRONMENTS)
    baseConditions.push(`environment_name = ANY($${baseParams.length})`)
  } else if (envFilter === 'dev') {
    baseParams.push(PROD_ENVIRONMENTS)
    baseConditions.push(`environment_name != ALL($${baseParams.length})`)
  }

  const optionsWhereSql = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : ''
  const triggerOptionsResult = await pool.query<{ trigger_event: string }>(
    `SELECT DISTINCT COALESCE(workflow_trigger_config->>'triggerEvent', 'unknown') AS trigger_event
     FROM deployments
     ${optionsWhereSql}`,
    baseParams,
  )
  const triggerOptions = triggerOptionsResult.rows
    .map((r) => r.trigger_event)
    .map((value) => ({ value, label: value === 'unknown' ? 'Ukjent' : getWorkflowTriggerLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'no'))

  const effectiveTriggerFilter =
    triggerFilter === 'all' || triggerOptions.some((opt) => opt.value === triggerFilter) ? triggerFilter : 'all'

  const params = [...baseParams]
  const conditions = [...baseConditions]
  if (effectiveTriggerFilter !== 'all') {
    params.push(effectiveTriggerFilter)
    conditions.push(`COALESCE(workflow_trigger_config->>'triggerEvent', 'unknown') = $${params.length}`)
  }
  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await pool.query<TriggerBreakdownRow>(
    `SELECT team_slug, app_name, environment_name,
            COALESCE(workflow_trigger_config->>'triggerEvent', 'unknown') AS trigger_event,
            (github_pr_number IS NOT NULL) AS via_pr,
            COUNT(*)::text AS count
     FROM deployments
     ${whereSql}
     GROUP BY team_slug, app_name, environment_name, trigger_event, via_pr
     ORDER BY team_slug, app_name, environment_name`,
    params,
  )

  const summaries = new Map<string, AppTriggerSummary>()
  for (const row of result.rows) {
    const key = `${row.team_slug}|${row.app_name}|${row.environment_name}`
    const count = parseInt(row.count, 10)
    let summary = summaries.get(key)
    if (!summary) {
      summary = {
        teamSlug: row.team_slug,
        appName: row.app_name,
        environmentName: row.environment_name,
        total: 0,
        byTrigger: {},
        viaPr: 0,
        viaDirectPush: 0,
        unknownCount: 0,
        unknownPercent: 0,
        manualCount: 0,
        manualPercent: 0,
        isProd: PROD_ENVIRONMENTS.includes(row.environment_name),
        flagged: false,
        lowConfidence: false,
      }
      summaries.set(key, summary)
    }
    summary.total += count
    summary.byTrigger[row.trigger_event] = (summary.byTrigger[row.trigger_event] ?? 0) + count
    if (row.via_pr) {
      summary.viaPr += count
    } else {
      summary.viaDirectPush += count
    }
  }

  const teamAppSummaries = [...summaries.values()]
  for (const summary of teamAppSummaries) {
    summary.unknownCount = summary.byTrigger.unknown ?? 0
    summary.unknownPercent = summary.total > 0 ? Math.round((summary.unknownCount / summary.total) * 100) : 0

    const knownTotal = summary.total - summary.unknownCount
    summary.manualCount = MANUAL_TRIGGER_EVENTS.reduce((sum, event) => sum + (summary.byTrigger[event] ?? 0), 0)
    summary.manualPercent = knownTotal > 0 ? Math.round((summary.manualCount / knownTotal) * 100) : 0

    summary.lowConfidence =
      summary.unknownPercent >= HIGH_UNKNOWN_THRESHOLD_PERCENT || knownTotal < MIN_KNOWN_SAMPLE_SIZE
    summary.flagged = summary.isProd && summary.manualCount > 0
  }

  teamAppSummaries.sort((a, b) => {
    if (a.teamSlug !== b.teamSlug) return a.teamSlug.localeCompare(b.teamSlug, 'no')
    if (a.appName !== b.appName) return a.appName.localeCompare(b.appName, 'no')
    return a.environmentName.localeCompare(b.environmentName, 'no')
  })

  const flaggedCount = teamAppSummaries.filter((s) => s.flagged).length
  const totalDeployments = teamAppSummaries.reduce((sum, s) => sum + s.total, 0)
  const totalUnknown = teamAppSummaries.reduce((sum, s) => sum + s.unknownCount, 0)
  const overallUnknownPercent = totalDeployments > 0 ? Math.round((totalUnknown / totalDeployments) * 100) : 0

  return {
    teamAppSummaries,
    flaggedCount,
    totalDeployments,
    totalUnknown,
    overallUnknownPercent,
    period,
    envFilter,
    triggerFilter: effectiveTriggerFilter,
    triggerOptions,
  }
}

export default function WorkflowPatternsAdminPage() {
  const {
    teamAppSummaries,
    flaggedCount,
    totalDeployments,
    totalUnknown,
    overallUnknownPercent,
    period,
    envFilter,
    triggerFilter,
    triggerOptions,
  } = useLoaderData<typeof loader>()

  const [searchParams, setSearchParams] = useSearchParams()

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    setSearchParams(newParams)
  }

  const onlyFlagged = searchParams.get('onlyFlagged') === 'true'
  const toggleOnlyFlagged = (checked: boolean) => {
    const newParams = new URLSearchParams(searchParams)
    if (checked) {
      newParams.set('onlyFlagged', 'true')
    } else {
      newParams.delete('onlyFlagged')
    }
    setSearchParams(newParams)
  }
  const visibleSummaries = onlyFlagged ? teamAppSummaries.filter((s) => s.flagged) : teamAppSummaries

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Workflow-mønstre (alle apper)
        </Heading>
        <BodyShort textColor="subtle">
          Analyser hvordan team og applikasjoner starter deployments (trigger-type), for å forstå arbeidsmønstre og
          identifisere avvik som bør følges opp.
        </BodyShort>
        <Detail textColor="subtle">
          {totalDeployments} deployments i valgt periode, {totalUnknown} ({overallUnknownPercent}%) mangler
          trigger-informasjon (legacy/ikke synkronisert) og telles som «Ukjent».
        </Detail>
      </div>

      <ReadMore header="Hva betyr de forskjellige trigger-typene?">
        <VStack gap="space-12">
          <BodyLong>
            Trigger-typen forteller hvilken GitHub Actions-hendelse (<code>on:</code>) som startet workflow-kjøringen.
            Beskrivelsene under er basert på GitHubs offisielle dokumentasjon:{' '}
            <ExternalLink href={GITHUB_TRIGGER_DOCS_URL}>Events that trigger workflows</ExternalLink>.
          </BodyLong>
          {getAllKnownWorkflowTriggerEvents().map(({ event, label, description }) => (
            <div key={event}>
              <BodyShort weight="semibold">
                {label} (<code>{event}</code>)
              </BodyShort>
              <BodyShort textColor="subtle">{description}</BodyShort>
            </div>
          ))}
          <div>
            <BodyShort weight="semibold">Ukjent</BodyShort>
            <BodyShort textColor="subtle">{getWorkflowTriggerDescription('unknown')}</BodyShort>
          </div>
        </VStack>
      </ReadMore>

      <HStack gap="space-16" wrap>
        <Select label="Periode" size="small" value={period} onChange={(e) => updateFilter('period', e.target.value)}>
          {TIME_PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Select label="Miljø" size="small" value={envFilter} onChange={(e) => updateFilter('env', e.target.value)}>
          <option value="all">Alle miljøer</option>
          <option value="prod">Kun prod</option>
          <option value="dev">Kun dev</option>
        </Select>
        <Select
          label="Trigger-type"
          size="small"
          value={triggerFilter}
          onChange={(e) => updateFilter('trigger', e.target.value)}
        >
          <option value="all">Alle trigger-typer</option>
          {triggerOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </HStack>

      <Switch checked={onlyFlagged} onChange={(e) => toggleOnlyFlagged(e.target.checked)}>
        Vis kun app-miljøer som trenger oppfølging (minst én manuell prodsetting)
      </Switch>

      {flaggedCount > 0 && (
        <Box background="warning-soft" padding="space-16" borderRadius="8">
          <HStack gap="space-8" align="center">
            <ExclamationmarkTriangleIcon aria-hidden />
            <BodyShort>
              {flaggedCount} app-miljø-kombinasjon(er) har minst én manuelt trigget deployment
              (workflow_dispatch/repository_dispatch) i prod. NDA kan ikke bekrefte at innholdet i en manuell
              prodsetting er verifisert.
            </BodyShort>
          </HStack>
        </Box>
      )}

      <Table size="small">
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Team</Table.HeaderCell>
            <Table.HeaderCell>App</Table.HeaderCell>
            <Table.HeaderCell>Miljø</Table.HeaderCell>
            <Table.HeaderCell>Totalt</Table.HeaderCell>
            <Table.HeaderCell>Trigger-fordeling</Table.HeaderCell>
            <Table.HeaderCell>Uten PR</Table.HeaderCell>
            <Table.HeaderCell>Flagg</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {visibleSummaries.map((summary) => {
            const directPushPercent = summary.total > 0 ? Math.round((summary.viaDirectPush / summary.total) * 100) : 0
            return (
              <Table.Row key={`${summary.teamSlug}-${summary.appName}-${summary.environmentName}`}>
                <Table.DataCell>{summary.teamSlug}</Table.DataCell>
                <Table.DataCell>
                  <Link
                    to={`/team/${summary.teamSlug}/env/${summary.environmentName}/app/${summary.appName}/deployments`}
                  >
                    {summary.appName}
                  </Link>
                </Table.DataCell>
                <Table.DataCell>{summary.environmentName}</Table.DataCell>
                <Table.DataCell>{summary.total}</Table.DataCell>
                <Table.DataCell>
                  <HStack gap="space-4" wrap>
                    {Object.entries(summary.byTrigger)
                      .sort((a, b) => b[1] - a[1])
                      .map(([triggerEvent, count]) => (
                        <Tag key={triggerEvent} size="xsmall" variant={triggerEvent === 'unknown' ? 'neutral' : 'info'}>
                          {triggerEvent === 'unknown' ? 'Ukjent' : getWorkflowTriggerLabel(triggerEvent)}:{' '}
                          {Math.round((count / summary.total) * 100)}%
                        </Tag>
                      ))}
                  </HStack>
                </Table.DataCell>
                <Table.DataCell>
                  <Detail>{directPushPercent}%</Detail>
                </Table.DataCell>
                <Table.DataCell>
                  <VStack gap="space-4">
                    {summary.flagged && (
                      <Tag size="xsmall" variant="warning">
                        {`${summary.manualCount} ${summary.manualCount === 1 ? 'manuell' : 'manuelle'} i prod (${summary.manualPercent}%)`}
                      </Tag>
                    )}
                    {summary.lowConfidence && summary.total > 0 && (
                      <Tag size="xsmall" variant="neutral">
                        Usikkert datagrunnlag ({summary.unknownPercent}% ukjent)
                      </Tag>
                    )}
                  </VStack>
                </Table.DataCell>
              </Table.Row>
            )
          })}
        </Table.Body>
      </Table>

      {teamAppSummaries.length === 0 && <BodyShort textColor="subtle">Ingen data funnet for valgt periode.</BodyShort>}
      {teamAppSummaries.length > 0 && visibleSummaries.length === 0 && (
        <BodyShort textColor="subtle">Ingen app-miljøer trenger oppfølging for valgte filtre.</BodyShort>
      )}
    </VStack>
  )
}
