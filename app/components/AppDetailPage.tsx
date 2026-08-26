import {
  BarChartIcon,
  CheckmarkIcon,
  CogIcon,
  DownloadIcon,
  ExclamationmarkTriangleIcon,
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
import { Form, Link, useSearchParams } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { BaselineInfo } from '~/components/BaselineInfo'
import { ExternalLink } from '~/components/ExternalLink'
import { GithubVerificationProgress } from '~/components/GithubVerificationProgress'
import { NotFoundInNaisNotice } from '~/components/NotFoundInNaisNotice'
import { ReactivateAppNotice } from '~/components/ReactivateAppNotice'
import { StatCard } from '~/components/StatCard'
import { SYNC_JOB_STATUS_LABELS, type SyncJobStatus } from '~/db/sync-job-types'
import { TIME_PERIOD_OPTIONS } from '~/lib/time-periods'

export type { SyncJobStatus }

export interface AppDetailApp {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  default_branch: string | null
  is_active: boolean
  not_found_in_nais_at: string | Date | null
}

export interface AppDetailRepository {
  id: number
  github_owner: string
  github_repo_name: string
  status: 'active' | 'pending_approval' | 'historical'
  redirects_to_owner: string | null
  redirects_to_repo: string | null
  created_at: string | Date
}

export interface AppDetailAlert {
  id: number
  deployment_id: number
  alert_type: 'repository_mismatch' | 'pending_approval' | 'historical_repository'
  expected_github_owner: string
  expected_github_repo_name: string
  detected_github_owner: string
  detected_github_repo_name: string
  created_at: string | Date
}

export interface AppDetailAuditReport {
  id: number
  report_id: string
  year: number
  total_deployments: number
  pr_approved_count: number
  manually_approved_count: number
  generated_at: string | Date
}

export interface AppDetailDeploymentStats {
  total: number
  with_four_eyes: number
  without_four_eyes: number
  pending_verification: number
  four_eyes_percentage: number
  last_deployment: string | Date | null
  last_deployment_id: number | null
  baseline_action_count?: number | null
}

export interface AppDetailGroup {
  id: number
  name: string
}

export interface AppDetailSibling {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
}

export interface AppDetailDevTeam {
  id: number
  name: string
  slug: string
  section_slug: string
}

export interface AppDetailLatestSyncJob {
  status: SyncJobStatus
  started_at: string | Date | null
  completed_at: string | Date | null
  created_at: string | Date
}

export interface AppDetailVerificationProgress {
  total: number
  pending: number
}

export interface AppDetailLoaderData {
  app: AppDetailApp
  canDeactivate: boolean
  canReactivate: boolean
  repositories: AppDetailRepository[]
  activeRepo: AppDetailRepository | undefined
  pendingRepos: AppDetailRepository[]
  historicalRepos: AppDetailRepository[]
  deploymentStats: AppDetailDeploymentStats
  alerts: AppDetailAlert[]
  auditReports: AppDetailAuditReport[]
  group: AppDetailGroup | null
  siblings: AppDetailSibling[]
  devTeams: AppDetailDevTeam[]
  latestSyncJob: AppDetailLatestSyncJob | null
  verificationProgress: AppDetailVerificationProgress
  verifyLimitPerCycle: number
  syncIntervalMs: number
}

export interface AppDetailPageProps {
  loaderData: AppDetailLoaderData
  actionData?: Record<string, unknown> | null
  canAccessAdmin: boolean
}

export function AppDetailPage({ loaderData, actionData, canAccessAdmin }: AppDetailPageProps) {
  const {
    app,
    canDeactivate,
    canReactivate,
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
    latestSyncJob,
    verificationProgress,
    verifyLimitPerCycle,
    syncIntervalMs,
  } = loaderData
  const [searchParams] = useSearchParams()
  const currentPeriod = searchParams.get('period') || 'last-week'
  const [resolveModalOpen, setResolveModalOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<AppDetailAlert | null>(null)

  const openResolveModal = (alert: AppDetailAlert) => {
    setSelectedAlert(alert)
    setResolveModalOpen(true)
  }

  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`
  const naisConsoleUrl = `https://console.nav.cloud.nais.io/team/${app.team_slug}/${app.environment_name}/app/${app.app_name}`
  const syncStatusVariant: Record<SyncJobStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
    completed: 'success',
    running: 'neutral',
    failed: 'error',
    cancelled: 'warning',
    pending: 'neutral',
  }
  const lastSyncTimestamp = latestSyncJob
    ? new Date(latestSyncJob.completed_at || latestSyncJob.started_at || latestSyncJob.created_at).toLocaleString(
        'nb-NO',
        { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
      )
    : null
  const lastSyncLabel =
    latestSyncJob && lastSyncTimestamp
      ? latestSyncJob.status === 'completed'
        ? `Sist synkronisert: ${lastSyncTimestamp}`
        : `Siste synk-forsøk: ${lastSyncTimestamp}`
      : null

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
              <code style={{ fontSize: '0.75rem' }}>{app.default_branch ?? 'ukjent'}</code>
            </BodyShort>
            <ExternalLink href={naisConsoleUrl}>Nais Console</ExternalLink>
            {latestSyncJob ? (
              <Tag variant={syncStatusVariant[latestSyncJob.status] || 'neutral'} size="small">
                {lastSyncLabel} ({SYNC_JOB_STATUS_LABELS[latestSyncJob.status]})
              </Tag>
            ) : (
              <Tag variant="warning" size="small">
                Ingen synkronisering registrert
              </Tag>
            )}
            {canAccessAdmin && (
              <Link to={`${appUrl}/admin/sync-jobs`} style={{ fontSize: '0.75rem' }}>
                Se sync-jobber
              </Link>
            )}
          </HStack>
        </div>
        {canAccessAdmin && (
          <Button as={Link} to={`${appUrl}/admin`} variant="tertiary" size="small" icon={<CogIcon aria-hidden />}>
            Administrer
          </Button>
        )}
      </HStack>

      <ActionAlert data={actionData} />

      {!app.is_active && <ReactivateAppNotice canReactivate={canReactivate} />}

      {app.not_found_in_nais_at && <NotFoundInNaisNotice variant="alert" canDeactivate={canDeactivate} />}

      {verificationProgress.pending > verifyLimitPerCycle && (
        <GithubVerificationProgress
          verified={verificationProgress.total - verificationProgress.pending}
          pending={verificationProgress.pending}
          total={verificationProgress.total}
          verifyLimitPerCycle={verifyLimitPerCycle}
          syncIntervalMs={syncIntervalMs}
        />
      )}

      {(deploymentStats.baseline_action_count ?? 0) > 0 && (
        <Alert variant="warning">
          <VStack gap="space-8">
            <BodyShort>
              <Link to={`${appUrl}/deployments?status=baseline_action&period=all`} style={{ color: 'inherit' }}>
                En deployment trenger baseline-godkjenning.
              </Link>
            </BodyShort>
            <BaselineInfo />
          </VStack>
        </Alert>
      )}

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

      {app.environment_name.startsWith('prod-') && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-20">
            <Heading level="2" size="medium">
              <FileTextIcon aria-hidden /> Leveranserapport
            </Heading>
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

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-20">
          <Heading level="2" size="medium">
            <PackageIcon aria-hidden /> Repositories
          </Heading>
          {activeRepo && (
            <VStack gap="space-8">
              <Label>Aktivt repository</Label>
              <HStack gap="space-8" align="center">
                <ExternalLink href={`https://github.com/${activeRepo.github_owner}/${activeRepo.github_repo_name}`}>
                  {activeRepo.github_owner}/{activeRepo.github_repo_name}
                </ExternalLink>
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
          {pendingRepos.length > 0 && (
            <VStack gap="space-12">
              <Label>Venter godkjenning ({pendingRepos.length})</Label>
              <VStack gap="space-8">
                {pendingRepos.map((repo) => (
                  <Box key={repo.id} padding="space-16" borderRadius="8" background="sunken">
                    <VStack gap="space-12">
                      <HStack gap="space-8" align="center" justify="space-between" wrap>
                        <HStack gap="space-8" align="center">
                          <ExternalLink href={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`}>
                            <BodyShort weight="semibold">
                              {repo.github_owner}/{repo.github_repo_name}
                            </BodyShort>
                          </ExternalLink>
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
          {historicalRepos.length > 0 && (
            <VStack gap="space-12">
              <Label>Historiske repositories ({historicalRepos.length})</Label>
              <VStack gap="space-8">
                {historicalRepos.map((repo) => (
                  <Box key={repo.id} padding="space-16" borderRadius="8" background="sunken">
                    <HStack gap="space-8" align="center" justify="space-between" wrap>
                      <HStack gap="space-8" align="center" wrap>
                        <ExternalLink href={`https://github.com/${repo.github_owner}/${repo.github_repo_name}`}>
                          <BodyShort>
                            {repo.github_owner}/{repo.github_repo_name}
                          </BodyShort>
                        </ExternalLink>
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
