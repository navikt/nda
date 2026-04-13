import {
  BarChartIcon,
  CheckmarkIcon,
  CogIcon,
  DownloadIcon,
  ExclamationmarkTriangleIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  LayersIcon,
  PackageIcon,
  PersonGroupIcon,
  XMarkIcon,
} from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HGrid,
  HStack,
  Label,
  Modal,
  Select,
  Show,
  Tag,
  Textarea,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link, useActionData, useLoaderData, useRouteLoaderData, useSearchParams } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { StatCard } from '~/components/StatCard'
import { getUnresolvedAlertsByApp, resolveRepositoryAlert } from '~/db/alerts.server'
import { updateImplicitApprovalSettings } from '~/db/app-settings.server'
import { getGroupByAppId, getSiblingApps } from '~/db/application-groups.server'
import {
  approveRepository,
  getRepositoriesByAppId,
  rejectRepository,
  setRepositoryAsActive,
} from '~/db/application-repositories.server'
import { getAuditReportsForApp } from '~/db/audit-reports.server'
import { getAppDeploymentStats } from '~/db/deployments.server'
import { getDevTeamsForApp } from '~/db/dev-teams.server'
import { getMonitoredApplicationByIdentity, updateMonitoredApplication } from '~/db/monitored-applications.server'
import { getUserIdentity } from '~/lib/auth.server'
import { logger } from '~/lib/logger.server'
import { requireTeamEnvAppParams } from '~/lib/route-params.server'
import { getDateRangeForPeriod, TIME_PERIOD_OPTIONS, type TimePeriod } from '~/lib/time-periods'
import type { loader as layoutLoader } from '../layout'
import type { Route } from './+types/$team.env.$env.app.$app'

export async function loader({ params, request }: Route.LoaderArgs) {
  const { team, env, app: appName } = requireTeamEnvAppParams(params)

  const url = new URL(request.url)
  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod

  const range = getDateRangeForPeriod(period)
  const startDate = range?.startDate
  const endDate = range?.endDate

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const [repositories, deploymentStats, alerts, auditReports, group, siblings, devTeams] = await Promise.all([
    getRepositoriesByAppId(app.id),
    getAppDeploymentStats(app.id, startDate, endDate, app.audit_start_year),
    getUnresolvedAlertsByApp(app.id),
    getAuditReportsForApp(app.id),
    getGroupByAppId(app.id),
    getSiblingApps(app.id),
    getDevTeamsForApp(app.id, team),
  ])

  const activeRepo = repositories.find((r) => r.status === 'active')
  const pendingRepos = repositories.filter((r) => r.status === 'pending_approval')
  const historicalRepos = repositories.filter((r) => r.status === 'historical')

  return {
    app,
    repositories,
    activeRepo,
    pendingRepos,
    historicalRepos,
    deploymentStats,
    alerts,
    auditReports,
    group,
    siblings,
    devTeams,
  }
}

export function meta({ data }: { data?: { app: { app_name: string } } }) {
  return [{ title: `${data?.app?.app_name ?? 'App'} - NDA` }]
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const action = formData.get('action')
  const identity = await getUserIdentity(request)

  try {
    if (action === 'approve_repo') {
      const repoId = parseInt(formData.get('repo_id') as string, 10)
      const setActive = formData.get('set_active') === 'true'
      await approveRepository(repoId, 'web-user', setActive)
      return { success: 'Repository godkjent!' }
    }

    if (action === 'reject_repo') {
      const repoId = parseInt(formData.get('repo_id') as string, 10)
      await rejectRepository(repoId)
      return { success: 'Repository avvist!' }
    }

    if (action === 'set_active') {
      const repoId = parseInt(formData.get('repo_id') as string, 10)
      await setRepositoryAsActive(repoId)
      return { success: 'Aktivt repository oppdatert!' }
    }

    if (action === 'resolve_alert') {
      const alertId = parseInt(formData.get('alert_id') as string, 10)
      const resolutionNote = formData.get('resolution_note') as string

      if (!resolutionNote?.trim()) {
        return { error: 'Vennligst skriv en merknad om hvordan varselet ble løst' }
      }

      await resolveRepositoryAlert(alertId, resolutionNote)
      return { success: 'Varsel markert som løst!' }
    }

    if (action === 'update_default_branch') {
      const appId = parseInt(formData.get('app_id') as string, 10)
      const defaultBranch = formData.get('default_branch') as string

      if (!defaultBranch?.trim()) {
        return { error: 'Default branch kan ikke være tom' }
      }

      await updateMonitoredApplication(appId, { default_branch: defaultBranch.trim() })
      return { success: `Default branch oppdatert til "${defaultBranch.trim()}"` }
    }

    if (action === 'update_implicit_approval') {
      const appId = parseInt(formData.get('app_id') as string, 10)
      const mode = formData.get('mode') as 'off' | 'dependabot_only' | 'all'

      if (!identity) {
        return { error: 'Du må være innlogget for å endre innstillinger' }
      }

      if (!['off', 'dependabot_only', 'all'].includes(mode)) {
        return { error: 'Ugyldig modus valgt' }
      }

      await updateImplicitApprovalSettings({
        monitoredAppId: appId,
        settings: { mode },
        changedByNavIdent: identity.navIdent,
        changedByName: identity.name || undefined,
      })

      return { success: 'Implisitt godkjenning-innstillinger oppdatert!' }
    }

    if (action === 'update_audit_start_year') {
      const appId = parseInt(formData.get('app_id') as string, 10)
      const startYearValue = formData.get('audit_start_year') as string

      // Allow empty value to clear the start year
      const auditStartYear = startYearValue?.trim() ? parseInt(startYearValue, 10) : null

      if (auditStartYear !== null && (Number.isNaN(auditStartYear) || auditStartYear < 2000 || auditStartYear > 2100)) {
        return { error: 'Ugyldig årstall (må være mellom 2000 og 2100)' }
      }

      await updateMonitoredApplication(appId, { audit_start_year: auditStartYear })
      return {
        success: auditStartYear ? `Startår oppdatert til ${auditStartYear}` : 'Startår fjernet',
      }
    }

    return { error: 'Ukjent handling' }
  } catch (error) {
    logger.error('Action error:', error)
    return { error: error instanceof Error ? error.message : 'En feil oppstod' }
  }
}

export default function AppDetail() {
  const {
    app,
    repositories,
    activeRepo,
    pendingRepos,
    historicalRepos,
    deploymentStats,
    alerts,
    auditReports,
    group,
    siblings,
    devTeams,
  } = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const [searchParams] = useSearchParams()
  const layoutData = useRouteLoaderData<typeof layoutLoader>('routes/layout')
  const isAdmin = layoutData?.user?.role === 'admin'
  const currentPeriod = searchParams.get('period') || 'last-week'
  const [resolveModalOpen, setResolveModalOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<(typeof alerts)[0] | null>(null)

  const openResolveModal = (alert: (typeof alerts)[0]) => {
    setSelectedAlert(alert)
    setResolveModalOpen(true)
  }

  // Helper to generate app URLs with the new structure
  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${app.team_slug}/${app.environment_name}/app/${app.app_name}`

  return (
    <VStack gap="space-32">
      <HStack justify="space-between" align="start" wrap>
        <div>
          <Heading level="1" size="large">
            {app.app_name}
          </Heading>
          <HStack gap="space-16" align="center" wrap>
            <BodyShort textColor="subtle">
              Team: <code style={{ fontSize: '0.75rem' }}>{app.team_slug}</code> | Miljø:{' '}
              <code style={{ fontSize: '0.75rem' }}>{app.environment_name}</code> | Branch:{' '}
              <code style={{ fontSize: '0.75rem' }}>{app.default_branch}</code>
            </BodyShort>
            <Button
              as="a"
              href={naisConsoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="tertiary"
              size="xsmall"
              icon={<ExternalLinkIcon aria-hidden />}
              iconPosition="right"
            >
              Nais Console
            </Button>
          </HStack>
        </div>
        {isAdmin && (
          <Button as={Link} to={`${appUrl}/admin`} variant="tertiary" size="small" icon={<CogIcon aria-hidden />}>
            Administrer
          </Button>
        )}
      </HStack>

      <ActionAlert data={actionData} />

      {/* Application Group Banner */}
      {group && siblings.length > 0 && (
        <Box padding="space-16" borderRadius="8" background="neutral-soft">
          <HStack gap="space-12" align="center" wrap>
            <LayersIcon aria-hidden />
            <BodyShort size="small" weight="semibold">
              {group.name}
            </BodyShort>
            <Tag variant="neutral" size="xsmall">
              {app.environment_name}
            </Tag>
            {siblings.map((s) => (
              <Link
                key={s.id}
                to={`/team/${s.team_slug}/env/${s.environment_name}/app/${s.app_name}`}
                style={{ textDecoration: 'none' }}
              >
                <Tag variant="neutral" size="xsmall">
                  {s.environment_name}
                </Tag>
              </Link>
            ))}
          </HStack>
        </Box>
      )}

      {/* Dev Teams */}
      {devTeams.length > 0 && (
        <HStack gap="space-8" align="center" wrap>
          <PersonGroupIcon aria-hidden />
          <Detail textColor="subtle">Utviklingsteam:</Detail>
          {devTeams.map((dt) => (
            <Link key={dt.id} to={`/sections/${dt.section_slug}/teams/${dt.slug}`} style={{ textDecoration: 'none' }}>
              <Tag variant="moderate" size="small" data-color="neutral">
                {dt.name}
              </Tag>
            </Link>
          ))}
        </HStack>
      )}

      {/* Statistics Section */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-20">
          <HStack justify="space-between" align="center" wrap>
            <Heading level="2" size="medium">
              <BarChartIcon aria-hidden /> Statistikk
            </Heading>
            <Form method="get" onChange={(e) => e.currentTarget.submit()}>
              <Select label="Tidsperiode" name="period" defaultValue={currentPeriod} size="small" hideLabel>
                {TIME_PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Form>
          </HStack>
          <HGrid gap="space-16" columns={{ xs: 2, md: 3, lg: 5 }}>
            <StatCard
              label="Totalt deployments"
              value={deploymentStats.total}
              to={`${appUrl}/deployments?period=${currentPeriod}`}
              compact
            />
            <StatCard
              label="Godkjent"
              value={`${deploymentStats.with_four_eyes} (${deploymentStats.four_eyes_percentage}%)`}
              variant="success"
              to={`${appUrl}/deployments?status=approved&period=${currentPeriod}`}
              compact
            />
            <StatCard
              label="Mangler godkjenning"
              value={deploymentStats.without_four_eyes}
              variant="danger"
              to={`${appUrl}/deployments?status=not_approved&period=${currentPeriod}`}
              compact
            />
            <StatCard
              label="Venter verifisering"
              value={deploymentStats.pending_verification}
              variant="warning"
              to={`${appUrl}/deployments?status=pending&period=${currentPeriod}`}
              compact
            />
            {deploymentStats.last_deployment_id && deploymentStats.last_deployment ? (
              <StatCard
                label="Siste deployment"
                value={new Date(deploymentStats.last_deployment).toLocaleString('no-NO')}
                to={`${appUrl}/deployments?status=pending&period=${currentPeriod}`}
                compact
              />
            ) : (
              <StatCard label="Siste deployment" value="Ingen deployments" compact />
            )}
          </HGrid>
        </VStack>
      </Box>

      {/* Audit Reports Section - Only for production apps */}
      {app.environment_name.startsWith('prod-') && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-20">
            <Heading level="2" size="medium">
              <FileTextIcon aria-hidden /> Leveranserapport
            </Heading>

            {/* Existing reports */}
            {auditReports.length > 0 ? (
              <VStack gap="space-12">
                {auditReports.map((report) => (
                  <Box key={report.id} padding="space-16" borderRadius="8" background="sunken">
                    <HStack gap="space-16" align="center" justify="space-between" wrap>
                      <VStack gap="space-4">
                        <HStack gap="space-8" align="center">
                          <Tag data-color="success" size="xsmall" variant="moderate">
                            {report.year}
                          </Tag>
                          <BodyShort weight="semibold">{report.total_deployments} deployments</BodyShort>
                        </HStack>
                        <Detail textColor="subtle">
                          Generert: {new Date(report.generated_at).toLocaleDateString('nb-NO')} •{' '}
                          {report.pr_approved_count} PR, {report.manually_approved_count} manuell
                        </Detail>
                        <Detail textColor="subtle">Dokument-ID: {report.report_id}</Detail>
                      </VStack>
                      <HStack gap="space-8">
                        <Button
                          as="a"
                          href={`/admin/audit-reports/${report.id}/view`}
                          target="_blank"
                          size="small"
                          variant="tertiary"
                          icon={<EyeIcon aria-hidden />}
                        >
                          Vis
                        </Button>
                        <Button
                          as="a"
                          href={`/admin/audit-reports/${report.id}/pdf`}
                          size="small"
                          variant="tertiary"
                          icon={<DownloadIcon aria-hidden />}
                        >
                          Last ned
                        </Button>
                      </HStack>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            ) : (
              <BodyShort textColor="subtle">Ingen leveranserapport er generert for denne applikasjonen.</BodyShort>
            )}
          </VStack>
        </Box>
      )}

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <Box
          id="varsler"
          padding="space-24"
          borderRadius="8"
          background="raised"
          borderColor="warning-subtle"
          borderWidth="1"
        >
          <VStack gap="space-16">
            <Heading level="2" size="medium">
              <ExclamationmarkTriangleIcon aria-hidden /> Åpne varsler ({alerts.length})
            </Heading>
            <VStack gap="space-12">
              {alerts.map((alert) => (
                <Box key={alert.id} padding="space-16" borderRadius="8" background="sunken">
                  <VStack gap="space-12">
                    {/* First row: Type tag, date, action buttons */}
                    <HStack gap="space-8" align="center" justify="space-between" wrap>
                      <HStack gap="space-12" align="center">
                        <Tag data-color="warning" size="xsmall" variant="outline">
                          {alert.alert_type === 'repository_mismatch' && 'Ukjent repo'}
                          {alert.alert_type === 'pending_approval' && 'Venter godkjenning'}
                          {alert.alert_type === 'historical_repository' && 'Historisk repo'}
                        </Tag>
                        <Detail textColor="subtle">{new Date(alert.created_at).toLocaleDateString('no-NO')}</Detail>
                      </HStack>
                      <HStack gap="space-8">
                        <Button
                          as={Link}
                          to={`${appUrl}/deployments/${alert.deployment_id}`}
                          size="xsmall"
                          variant="tertiary"
                        >
                          Se deployment
                        </Button>
                        <Button
                          size="xsmall"
                          variant="secondary"
                          icon={<CheckmarkIcon aria-hidden />}
                          onClick={() => openResolveModal(alert)}
                        >
                          Løs
                        </Button>
                      </HStack>
                    </HStack>
                    {/* Repository comparison */}
                    <VStack gap="space-4">
                      <HStack gap="space-8" wrap>
                        <Detail textColor="subtle">Forventet:</Detail>
                        <code style={{ fontSize: '0.75rem' }}>
                          {alert.expected_github_owner}/{alert.expected_github_repo_name}
                        </code>
                      </HStack>
                      <HStack gap="space-8" wrap>
                        <Detail textColor="subtle">Detektert:</Detail>
                        <code style={{ fontSize: '0.75rem', color: 'var(--ax-text-danger)' }}>
                          {alert.detected_github_owner}/{alert.detected_github_repo_name}
                        </code>
                      </HStack>
                    </VStack>
                  </VStack>
                </Box>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}

      {/* Resolve Alert Modal */}
      <Modal
        open={resolveModalOpen}
        onClose={() => setResolveModalOpen(false)}
        header={{ heading: 'Løs repository-varsel' }}
      >
        <Modal.Body>
          {selectedAlert && (
            <VStack gap="space-16">
              <BodyShort>Du er i ferd med å markere dette varselet som løst:</BodyShort>
              <Alert variant="warning">
                <strong>{app.app_name}</strong> ({app.environment_name})
                <br />
                Forventet: {selectedAlert.expected_github_owner}/{selectedAlert.expected_github_repo_name}
                <br />
                Detektert: {selectedAlert.detected_github_owner}/{selectedAlert.detected_github_repo_name}
              </Alert>

              <Form method="post" onSubmit={() => setResolveModalOpen(false)}>
                <input type="hidden" name="action" value="resolve_alert" />
                <input type="hidden" name="alert_id" value={selectedAlert.id} />

                <Textarea
                  name="resolution_note"
                  label="Hvordan ble varselet løst?"
                  description="Forklar hva som ble gjort for å løse varselet"
                  required
                  minLength={10}
                />

                <HStack gap="space-16" justify="end" marginBlock="space-16 space-0">
                  <Button type="button" variant="secondary" onClick={() => setResolveModalOpen(false)}>
                    Avbryt
                  </Button>
                  <Button type="submit" variant="primary">
                    Marker som løst
                  </Button>
                </HStack>
              </Form>
            </VStack>
          )}
        </Modal.Body>
      </Modal>

      {/* Repositories Section */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-20">
          <Heading level="2" size="medium">
            <PackageIcon aria-hidden /> Repositories
          </Heading>

          {/* Active Repository */}
          {activeRepo && (
            <VStack gap="space-8">
              <Label>Aktivt repository</Label>
              <HStack gap="space-8" align="center">
                <Link
                  to={`https://github.com/${activeRepo.github_owner}/${activeRepo.github_repo_name}`}
                  target="_blank"
                >
                  {activeRepo.github_owner}/{activeRepo.github_repo_name}
                </Link>
                <Tag data-color="success" size="xsmall" variant="outline">
                  AKTIV
                </Tag>
              </HStack>
            </VStack>
          )}

          {!activeRepo && (
            <Alert variant="warning" size="small">
              Ingen aktivt repository satt for denne applikasjonen
            </Alert>
          )}

          {/* Pending Approval */}
          {pendingRepos.length > 0 && (
            <VStack gap="space-12">
              <Label>Venter godkjenning ({pendingRepos.length})</Label>
              <VStack gap="space-8">
                {pendingRepos.map((repo) => (
                  <Box key={repo.id} padding="space-16" borderRadius="8" background="sunken">
                    <VStack gap="space-12">
                      <HStack gap="space-8" align="center" justify="space-between" wrap>
                        <HStack gap="space-8" align="center">
                          <Link to={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`} target="_blank">
                            <BodyShort weight="semibold">
                              {repo.github_owner}/{repo.github_repo_name}
                            </BodyShort>
                          </Link>
                          <Tag data-color="warning" size="xsmall" variant="outline">
                            Venter
                          </Tag>
                        </HStack>
                        <Detail textColor="subtle">{new Date(repo.created_at).toLocaleDateString('no-NO')}</Detail>
                      </HStack>
                      <HStack gap="space-8" wrap>
                        <Form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="approve_repo" />
                          <input type="hidden" name="repo_id" value={repo.id} />
                          <input type="hidden" name="set_active" value="true" />
                          <Button type="submit" size="xsmall" variant="primary" icon={<CheckmarkIcon aria-hidden />}>
                            Godkjenn som aktiv
                          </Button>
                        </Form>
                        <Show above="sm">
                          <Form method="post" style={{ display: 'inline' }}>
                            <input type="hidden" name="action" value="approve_repo" />
                            <input type="hidden" name="repo_id" value={repo.id} />
                            <input type="hidden" name="set_active" value="false" />
                            <Button type="submit" size="xsmall" variant="secondary">
                              Godkjenn som historisk
                            </Button>
                          </Form>
                        </Show>
                        <Form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="reject_repo" />
                          <input type="hidden" name="repo_id" value={repo.id} />
                          <Button type="submit" size="xsmall" variant="danger" icon={<XMarkIcon aria-hidden />}>
                            Avvis
                          </Button>
                        </Form>
                      </HStack>
                    </VStack>
                  </Box>
                ))}
              </VStack>
            </VStack>
          )}

          {/* Historical Repositories */}
          {historicalRepos.length > 0 && (
            <VStack gap="space-12">
              <Label>Historiske repositories ({historicalRepos.length})</Label>
              <VStack gap="space-8">
                {historicalRepos.map((repo) => (
                  <Box key={repo.id} padding="space-16" borderRadius="8" background="sunken">
                    <HStack gap="space-8" align="center" justify="space-between" wrap>
                      <HStack gap="space-8" align="center" wrap>
                        <Link to={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`} target="_blank">
                          <BodyShort>
                            {repo.github_owner}/{repo.github_repo_name}
                          </BodyShort>
                        </Link>
                        {repo.redirects_to_owner && (
                          <Tag data-color="info" size="xsmall" variant="outline">
                            → {repo.redirects_to_owner}/{repo.redirects_to_repo}
                          </Tag>
                        )}
                        <Show above="md">
                          <Detail textColor="subtle">{new Date(repo.created_at).toLocaleDateString('no-NO')}</Detail>
                        </Show>
                      </HStack>
                      <Form method="post" style={{ display: 'inline' }}>
                        <input type="hidden" name="action" value="set_active" />
                        <input type="hidden" name="repo_id" value={repo.id} />
                        <Button type="submit" size="xsmall" variant="secondary">
                          Sett som aktiv
                        </Button>
                      </Form>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            </VStack>
          )}

          {repositories.length === 0 && (
            <BodyShort textColor="subtle">Ingen repositories registrert for denne applikasjonen</BodyShort>
          )}
        </VStack>
      </Box>
    </VStack>
  )
}
