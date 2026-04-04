import { ChevronLeftIcon, ChevronRightIcon } from '@navikt/aksel-icons'
import { BodyShort, Box, Button, Detail, Hide, HStack, Select, Show, Tag, TextField, VStack } from '@navikt/ds-react'
import { Form, Link, redirect, useLoaderData, useSearchParams } from 'react-router'
import { MethodTag, StatusTag } from '~/components/deployment-tags'
import { getSiblingApps } from '~/db/application-groups.server'
import { type DeploymentFilters, getDeploymentsPaginated } from '~/db/deployments.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getUserMappings } from '~/db/user-mappings.server'
import type { FourEyesStatus } from '~/lib/four-eyes-status'
import { requireTeamEnvAppParams } from '~/lib/route-params.server'
import { getDateRangeForPeriod, TIME_PERIOD_OPTIONS, type TimePeriod } from '~/lib/time-periods'
import { getUserDisplayName, serializeUserMappings } from '~/lib/user-display'
import styles from '~/styles/common.module.css'
import type { Route } from './+types/$team.env.$env.app.$app.deployments'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.app ? `Deployments - ${data.app.app_name}` : 'Deployments' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { team, env, app: appName } = requireTeamEnvAppParams(params)

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const status = url.searchParams.get('status') || undefined
  const method = url.searchParams.get('method') as 'pr' | 'direct_push' | 'legacy' | undefined
  const deployer = url.searchParams.get('deployer') || undefined
  const sha = url.searchParams.get('sha') || undefined
  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod
  const showGroup = url.searchParams.get('group') === 'true'

  const range = getDateRangeForPeriod(period)

  // If group mode, fetch siblings and include all app IDs
  const siblings = showGroup ? await getSiblingApps(app.id) : []
  const hasGroup = siblings.length > 0

  const filters: DeploymentFilters = {
    ...(showGroup && hasGroup
      ? { monitored_app_ids: [app.id, ...siblings.map((s) => s.id)] }
      : { monitored_app_id: app.id }),
    page,
    per_page: 20,
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    deployer_username: deployer,
    commit_sha: sha,
    start_date: range?.startDate,
    end_date: range?.endDate,
    audit_start_year: app.audit_start_year,
  }

  const result = await getDeploymentsPaginated(filters)

  // Redirect to last valid page if requested page exceeds total pages
  if (page > result.total_pages && result.total_pages > 0) {
    url.searchParams.set('page', String(result.total_pages))
    throw redirect(url.pathname + url.search)
  }

  // Get display names for deployers
  const deployerUsernames = [...new Set(result.deployments.map((d) => d.deployer_username).filter(Boolean))] as string[]
  const userMappings = await getUserMappings(deployerUsernames)

  return {
    app,
    userMappings: serializeUserMappings(userMappings),
    hasGroup,
    showGroup: showGroup && hasGroup,
    ...result,
  }
}

export default function AppDeployments() {
  const { app, deployments, total, page, total_pages, userMappings, hasGroup, showGroup } =
    useLoaderData<typeof loader>()
  const [searchParams, setSearchParams] = useSearchParams()

  const currentStatus = searchParams.get('status') || ''
  const currentMethod = searchParams.get('method') || ''
  const currentDeployer = searchParams.get('deployer') || ''
  const currentSha = searchParams.get('sha') || ''
  const currentPeriod = searchParams.get('period') || 'last-week'

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    newParams.set('page', '1') // Reset to page 1 when filtering
    setSearchParams(newParams)
  }

  const goToPage = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', String(newPage))
    setSearchParams(newParams)
  }

  return (
    <VStack gap="space-32">
      {/* Filters */}
      <Box padding="space-20" borderRadius="8" background="sunken">
        <Form method="get">
          <VStack gap="space-16">
            <HStack gap="space-16" wrap>
              <Select
                label="Tidsperiode"
                size="small"
                value={currentPeriod}
                onChange={(e) => updateFilter('period', e.target.value)}
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
                onChange={(e) => updateFilter('status', e.target.value)}
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
                <option value="error">Feil</option>
                <option value="unknown">Ukjent</option>
              </Select>

              <Select
                label="Metode"
                size="small"
                value={currentMethod}
                onChange={(e) => updateFilter('method', e.target.value)}
              >
                <option value="">Alle</option>
                <option value="pr">Pull Request</option>
                <option value="direct_push">Direct Push</option>
                <option value="legacy">Legacy</option>
              </Select>

              <TextField
                label="Deployer"
                size="small"
                value={currentDeployer}
                onChange={(e) => updateFilter('deployer', e.target.value)}
                placeholder="Søk..."
              />

              <TextField
                label="Commit SHA"
                size="small"
                value={currentSha}
                onChange={(e) => updateFilter('sha', e.target.value)}
                placeholder="Søk..."
              />
            </HStack>
          </VStack>
        </Form>
      </Box>

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

      {/* Deployments list */}
      <div>
        {deployments.length === 0 ? (
          <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
            <BodyShort>Ingen deployments funnet med valgte filtre.</BodyShort>
          </Box>
        ) : (
          deployments.map((deployment) => (
            <Box key={deployment.id} padding="space-20" background="raised" className={styles.stackedListItem}>
              <VStack gap="space-12">
                {/* First row: Time, Title (on desktop), Tags (right-aligned) */}
                <HStack gap="space-8" align="center" justify="space-between">
                  <HStack gap="space-8" align="center" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <BodyShort weight="semibold" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {new Date(deployment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </BodyShort>
                    {showGroup && deployment.environment_name !== app.environment_name && (
                      <Tag variant="neutral" size="xsmall">
                        {deployment.environment_name}
                      </Tag>
                    )}
                    {/* Title on desktop - inline with time */}
                    <Show above="md">
                      {deployment.title && (
                        <BodyShort className={styles.truncateText} style={{ flex: 1, minWidth: 0 }}>
                          {deployment.title}
                        </BodyShort>
                      )}
                    </Show>
                  </HStack>
                  <HStack gap="space-8" style={{ flexShrink: 0 }}>
                    <MethodTag
                      github_pr_number={deployment.github_pr_number}
                      four_eyes_status={deployment.four_eyes_status as FourEyesStatus}
                    />
                    <StatusTag
                      four_eyes_status={deployment.four_eyes_status as FourEyesStatus}
                      has_four_eyes={deployment.has_four_eyes}
                    />
                  </HStack>
                </HStack>

                {/* Title on mobile - separate line */}
                <Hide above="md">
                  {deployment.title && <BodyShort className={styles.truncateText}>{deployment.title}</BodyShort>}
                </Hide>

                {/* Second row: Details and View button */}
                <HStack gap="space-16" align="center" justify="space-between" wrap>
                  <HStack gap="space-16" wrap>
                    <Detail textColor="subtle">
                      {deployment.deployer_username ? (
                        <Link to={`/users/${deployment.deployer_username}`}>
                          {getUserDisplayName(deployment.deployer_username, userMappings)}
                        </Link>
                      ) : (
                        '(ukjent)'
                      )}
                    </Detail>
                    <Detail textColor="subtle">
                      {deployment.commit_sha ? (
                        <a
                          href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontFamily: 'monospace' }}
                        >
                          {deployment.commit_sha.substring(0, 7)}
                        </a>
                      ) : (
                        '(ukjent)'
                      )}
                    </Detail>
                    {deployment.github_pr_number && (
                      <Detail textColor="subtle">
                        <a href={deployment.github_pr_url || '#'} target="_blank" rel="noopener noreferrer">
                          #{deployment.github_pr_number}
                        </a>
                      </Detail>
                    )}
                  </HStack>
                  <Button
                    as={Link}
                    to={`/team/${deployment.team_slug}/env/${deployment.environment_name}/app/${deployment.app_name}/deployments/${deployment.id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                    variant="tertiary"
                    size="small"
                  >
                    Vis
                  </Button>
                </HStack>
              </VStack>
            </Box>
          ))
        )}
      </div>

      {/* Pagination */}
      {total_pages > 1 && (
        <HStack gap="space-16" justify="center" align="center">
          <Button
            variant="tertiary"
            size="small"
            icon={<ChevronLeftIcon aria-hidden />}
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            Forrige
          </Button>
          <BodyShort>
            Side {page} av {total_pages}
          </BodyShort>
          <Button
            variant="tertiary"
            size="small"
            icon={<ChevronRightIcon aria-hidden />}
            iconPosition="right"
            disabled={page >= total_pages}
            onClick={() => goToPage(page + 1)}
          >
            Neste
          </Button>
        </HStack>
      )}
    </VStack>
  )
}
