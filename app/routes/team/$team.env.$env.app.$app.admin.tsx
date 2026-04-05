import { ChatIcon, CheckmarkCircleIcon, CogIcon, ExclamationmarkTriangleIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Detail,
  Heading,
  HStack,
  Label,
  Loader,
  Select,
  Switch,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Form, Link, useFetcher, useNavigation, useRevalidator } from 'react-router'
import { getAppConfigAuditLog, getImplicitApprovalSettings } from '~/db/app-settings.server'
import { getAuditReportsForApp } from '~/db/audit-reports.server'
import { getGitHubDataStatsForApp } from '~/db/github-data.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getLatestSyncJob, type SyncJob } from '~/db/sync-jobs.server'
import { requireAdmin } from '~/lib/auth.server'
import { getFourEyesStatusLabel } from '~/lib/four-eyes-status'
import { getCompletedPeriods, REPORT_PERIOD_TYPE_LABELS, type ReportPeriodType } from '~/lib/report-periods'
import type { Route } from './+types/$team.env.$env.app.$app.admin'

export { action } from './$team.env.$env.app.$app.admin.actions.server'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.app ? `Admin - ${data.app.app_name}` : 'Admin' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { team, env, app: appName } = params

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  // Check if this is a production app (audit reports only make sense for prod)
  const isProdApp = app.environment_name.startsWith('prod-')

  const [implicitApprovalSettings, recentConfigChanges, auditReports, latestFetchJob, githubDataStats] =
    await Promise.all([
      getImplicitApprovalSettings(app.id),
      getAppConfigAuditLog(app.id, { limit: 10 }),
      getAuditReportsForApp(app.id),
      getLatestSyncJob(app.id, 'fetch_verification_data'),
      getGitHubDataStatsForApp(app.id, app.audit_start_year),
    ])

  return {
    app,
    implicitApprovalSettings,
    recentConfigChanges,
    auditReports,
    isProdApp,
    latestFetchJob,
    githubDataStats,
  }
}

export default function AppAdmin({ loaderData, actionData }: Route.ComponentProps) {
  const {
    app,
    implicitApprovalSettings,
    recentConfigChanges,
    auditReports,
    isProdApp,
    latestFetchJob,
    githubDataStats,
  } = loaderData
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const isSubmitting = navigation.state === 'submitting'

  // Polling state for report background job (using useFetcher)
  const jobFetcher = useFetcher<{ status: string; error?: string }>()
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const [jobCompleted, setJobCompleted] = useState(false)

  const jobStatus = pendingJobId
    ? ((jobFetcher.data?.status as 'pending' | 'processing' | 'completed' | 'failed' | null) ?? 'pending')
    : null

  // Polling state for fetch data job
  const [fetchJobId, setFetchJobId] = useState<number | null>(null)
  const [fetchJobStatus, setFetchJobStatus] = useState<SyncJob | null>(latestFetchJob)

  // Period selection state
  const [periodType, setPeriodType] = useState<ReportPeriodType>('yearly')
  const availablePeriods = getCompletedPeriods(periodType, new Date(), app.audit_start_year ?? undefined)
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(0)
  const selectedPeriod = availablePeriods[selectedPeriodIndex] || availablePeriods[0]

  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  // Use action data for readiness (checked on demand)
  const readinessData = actionData?.readiness

  // Start polling when fetch job is started
  useEffect(() => {
    if (actionData?.fetchJobStarted) {
      setFetchJobId(actionData.fetchJobStarted)
    }
  }, [actionData?.fetchJobStarted])

  // Update fetch job status from action
  useEffect(() => {
    if (actionData?.fetchJobStatus) {
      setFetchJobStatus(actionData.fetchJobStatus)
    }
  }, [actionData?.fetchJobStatus])

  // Poll fetch job status
  useEffect(() => {
    if (!fetchJobId) return
    if (
      fetchJobStatus?.status === 'completed' ||
      fetchJobStatus?.status === 'failed' ||
      fetchJobStatus?.status === 'cancelled'
    )
      return

    const interval = setInterval(() => {
      revalidator.revalidate()
    }, 3000)

    return () => clearInterval(interval)
  }, [fetchJobId, fetchJobStatus?.status, revalidator])

  // Update fetch job status from loader
  useEffect(() => {
    if (latestFetchJob) {
      setFetchJobStatus(latestFetchJob)
    }
  }, [latestFetchJob])

  // Start polling when job is started
  useEffect(() => {
    if (actionData?.jobStarted) {
      setPendingJobId(actionData.jobStarted)
      setJobError(null)
      setJobCompleted(false)
    }
  }, [actionData?.jobStarted])

  // Stable ref for fetcher.load to avoid infinite re-renders in polling effect
  const jobFetcherLoadRef = useRef(jobFetcher.load)
  jobFetcherLoadRef.current = jobFetcher.load

  // Poll for job status using useFetcher
  useEffect(() => {
    if (!pendingJobId) return

    const load = () => jobFetcherLoadRef.current(`/api/reports/status?jobId=${pendingJobId}`)

    // Load immediately
    load()

    const interval = setInterval(load, 2000)

    return () => clearInterval(interval)
  }, [pendingJobId])

  // React to fetcher data changes
  useEffect(() => {
    if (!jobFetcher.data || !pendingJobId) return

    if (jobFetcher.data.status === 'completed') {
      setPendingJobId(null)
      setJobCompleted(true)
      revalidator.revalidate()
    } else if (jobFetcher.data.status === 'failed') {
      setPendingJobId(null)
      setJobError(jobFetcher.data.error || 'Ukjent feil')
    }
  }, [jobFetcher.data, pendingJobId, revalidator])

  return (
    <VStack gap="space-32">
      {/* Header */}
      <div>
        <HStack gap="space-12" align="center">
          <CogIcon aria-hidden fontSize="1.5rem" />
          <Heading size="large" level="1">
            Administrasjon for {app.app_name}
          </Heading>
        </HStack>
        <BodyShort textColor="subtle">Administrer leveranserapporter og innstillinger for applikasjonen.</BodyShort>
      </div>

      {/* Success/Error messages */}
      {actionData?.success && (
        <Box padding="space-16" borderRadius="8" background="success-softA">
          <BodyShort>{actionData.success}</BodyShort>
        </Box>
      )}
      {actionData?.error && (
        <Box padding="space-16" borderRadius="8" background="danger-softA">
          <BodyShort>{actionData.error}</BodyShort>
        </Box>
      )}
      {jobError && <Alert variant="error">Rapportgenerering feilet: {jobError}</Alert>}
      {jobCompleted && (
        <Alert variant="success">
          Leveranserapport er generert! Du finner den i listen over genererte rapporter nedenfor.
        </Alert>
      )}

      {/* Job progress indicator */}
      {pendingJobId && (
        <Alert variant="info">
          <HStack gap="space-12" align="center">
            <Loader size="small" />
            <span>
              {jobStatus === 'pending' && 'Starter rapportgenerering...'}
              {jobStatus === 'processing' && 'Genererer rapport... Dette kan ta opptil et minutt.'}
            </span>
          </HStack>
        </Alert>
      )}

      {/* Audit Report Generation - only for prod apps - MOVED TO TOP */}
      {isProdApp && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16">
            <div>
              <Heading size="small" level="2">
                Leveranserapport
              </Heading>
              <BodyShort textColor="subtle" size="small">
                Generer leveranserapport for revisjon. Rapporten dokumenterer four-eyes-prinsippet for alle deployments
                i valgt år.
              </BodyShort>
            </div>

            <Form method="post">
              <input type="hidden" name="app_id" value={app.id} />
              {selectedPeriod && (
                <>
                  <input type="hidden" name="year" value={selectedPeriod.year} />
                  <input type="hidden" name="period_type" value={selectedPeriod.type} />
                  <input type="hidden" name="period_label" value={selectedPeriod.label} />
                  <input type="hidden" name="period_start" value={selectedPeriod.startDate.toISOString()} />
                  <input type="hidden" name="period_end" value={selectedPeriod.endDate.toISOString()} />
                </>
              )}
              <VStack gap="space-16">
                <HStack gap="space-16" align="end" wrap>
                  <Select
                    label="Rapporttype"
                    value={periodType}
                    onChange={(e) => {
                      setPeriodType(e.target.value as ReportPeriodType)
                      setSelectedPeriodIndex(0)
                    }}
                    size="small"
                    style={{ minWidth: '140px' }}
                  >
                    {Object.entries(REPORT_PERIOD_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>

                  <Select
                    label="Periode"
                    value={String(selectedPeriodIndex)}
                    onChange={(e) => setSelectedPeriodIndex(Number(e.target.value))}
                    size="small"
                    style={{ minWidth: '180px' }}
                  >
                    {availablePeriods.map((period, index) => (
                      <option key={period.label} value={index}>
                        {period.label}
                      </option>
                    ))}
                  </Select>

                  <Button
                    type="submit"
                    name="action"
                    value="check_readiness"
                    variant="secondary"
                    size="small"
                    loading={isSubmitting && navigation.formData?.get('action') === 'check_readiness'}
                    disabled={!selectedPeriod || !!pendingJobId}
                  >
                    Kontroller grunnlag
                  </Button>

                  <Button
                    type="submit"
                    name="action"
                    value="generate_report"
                    variant="primary"
                    size="small"
                    loading={
                      (isSubmitting && navigation.formData?.get('action') === 'generate_report') || !!pendingJobId
                    }
                    disabled={!readinessData?.is_ready || !!pendingJobId}
                  >
                    {pendingJobId ? 'Genererer...' : 'Generer rapport'}
                  </Button>
                </HStack>

                {/* Readiness check result */}
                {readinessData && (
                  <Box
                    padding="space-16"
                    borderRadius="4"
                    background={readinessData.is_ready ? 'success-soft' : 'warning-soft'}
                  >
                    <VStack gap="space-8">
                      <HStack gap="space-8" align="center">
                        {readinessData.is_ready ? (
                          <>
                            <CheckmarkCircleIcon aria-hidden fontSize="1.5rem" />
                            <Heading size="xsmall" level="3">
                              Klar for leveranserapport
                            </Heading>
                          </>
                        ) : (
                          <>
                            <ExclamationmarkTriangleIcon aria-hidden fontSize="1.5rem" />
                            <Heading size="xsmall" level="3">
                              Ikke klar
                            </Heading>
                          </>
                        )}
                      </HStack>

                      <HStack gap="space-24" wrap>
                        <div>
                          <Detail>Totalt deployments</Detail>
                          <BodyShort weight="semibold">{readinessData.total_deployments}</BodyShort>
                        </div>
                        <div>
                          <Detail>Godkjent</Detail>
                          <BodyShort weight="semibold">{readinessData.approved_count}</BodyShort>
                        </div>
                        {readinessData.legacy_count > 0 && (
                          <div>
                            <Detail>Legacy</Detail>
                            <BodyShort weight="semibold">{readinessData.legacy_count}</BodyShort>
                          </div>
                        )}
                        <div>
                          <Detail>Venter godkjenning</Detail>
                          <BodyShort weight="semibold">{readinessData.pending_count}</BodyShort>
                        </div>
                      </HStack>

                      {readinessData.pending_count > 0 && (
                        <div>
                          <Detail>Deployments som mangler godkjenning:</Detail>
                          <VStack gap="space-4">
                            {readinessData.pending_deployments.map((d) => (
                              <HStack key={d.id} gap="space-8" align="center">
                                <AkselLink as={Link} to={`${appUrl}/deployments/${d.id}`}>
                                  {d.commit_sha?.substring(0, 7) || 'N/A'}
                                </AkselLink>
                                <BodyShort size="small">
                                  {new Date(d.created_at).toLocaleDateString('no-NO')} • {d.deployer_username} •{' '}
                                  {getFourEyesStatusLabel(d.four_eyes_status)}
                                </BodyShort>
                              </HStack>
                            ))}
                          </VStack>
                        </div>
                      )}
                    </VStack>
                  </Box>
                )}
              </VStack>
            </Form>

            {/* Existing reports for this app */}
            {auditReports.length > 0 && (
              <VStack gap="space-8">
                <Label>Eksisterende rapporter</Label>
                <VStack gap="space-4">
                  {auditReports.map((report) => (
                    <HStack key={report.id} gap="space-16" align="center">
                      <BodyShort weight="semibold">{report.period_label}</BodyShort>
                      <Detail textColor="subtle">{report.report_id}</Detail>
                      <HStack gap="space-8">
                        <AkselLink href={`/admin/audit-reports/${report.id}/view`} target="_blank">
                          Vis
                        </AkselLink>
                        <AkselLink href={`/admin/audit-reports/${report.id}/pdf`} target="_blank">
                          Last ned
                        </AkselLink>
                      </HStack>
                    </HStack>
                  ))}
                </VStack>
              </VStack>
            )}
          </VStack>
        </Box>
      )}

      {/* Default Branch */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Default branch
          </Heading>
          <Form method="post">
            <input type="hidden" name="action" value="update_default_branch" />
            <input type="hidden" name="app_id" value={app.id} />
            <HStack gap="space-16" align="end" wrap>
              <TextField
                label="Branch"
                description="Branchen som PR-er må gå til for å bli godkjent (f.eks. main, master)"
                name="default_branch"
                defaultValue={app.default_branch}
                size="small"
                style={{ minWidth: '200px' }}
              />
              <Button type="submit" size="small" variant="secondary">
                Lagre
              </Button>
            </HStack>
          </Form>
        </VStack>
      </Box>

      {/* Audit Start Year */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Startår for revisjon
          </Heading>
          <Form method="post">
            <input type="hidden" name="action" value="update_audit_start_year" />
            <input type="hidden" name="app_id" value={app.id} />
            <HStack gap="space-16" align="end" wrap>
              <TextField
                label="År"
                description="Deployments før dette året ignoreres i statistikk og rapporter"
                name="audit_start_year"
                type="number"
                defaultValue={app.audit_start_year ?? ''}
                size="small"
                style={{ minWidth: '120px' }}
              />
              <Button type="submit" size="small" variant="secondary">
                Lagre
              </Button>
            </HStack>
          </Form>
        </VStack>
      </Box>

      {/* Implicit Approval Settings */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small" level="2">
              Implisitt godkjenning
            </Heading>
            <BodyShort textColor="subtle" size="small">
              Godkjenner automatisk en PR hvis den som merger ikke er PR-oppretteren og ikke har siste commit.
            </BodyShort>
          </div>

          <Form method="post">
            <input type="hidden" name="action" value="update_implicit_approval" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-12">
              <Select
                label="Modus"
                name="mode"
                defaultValue={implicitApprovalSettings.mode}
                size="small"
                style={{ maxWidth: '300px' }}
              >
                <option value="off">Av</option>
                <option value="dependabot_only">Kun Dependabot</option>
                <option value="all">Alle</option>
              </Select>

              <BodyShort size="small" textColor="subtle">
                <strong>Kun Dependabot:</strong> Godkjenner automatisk PRer opprettet av Dependabot med kun
                Dependabot-commits.
                <br />
                <strong>Alle:</strong> Godkjenner alle PRer der den som merger verken opprettet PRen eller har siste
                commit.
              </BodyShort>

              <Button type="submit" size="small" variant="secondary">
                Lagre innstillinger
              </Button>
            </VStack>
          </Form>
        </VStack>
      </Box>

      {/* Test Requirements */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small" level="2">
              Testkrav for leveranser
            </Heading>
            <BodyShort textColor="subtle" size="small">
              Spesifiser hvilke tester som må være vellykket før en leveranse kan gjennomføres.
            </BodyShort>
          </div>

          <Form method="post">
            <input type="hidden" name="action" value="update_test_requirement" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-12">
              <Select
                label="Testkrav"
                name="test_requirement"
                defaultValue={app.test_requirement || 'none'}
                size="small"
                style={{ maxWidth: '300px' }}
              >
                <option value="none">Ingen</option>
                <option value="unit_tests">Enhetstester</option>
                <option value="integration_tests">Integrasjonstester</option>
              </Select>

              <BodyShort size="small" textColor="subtle">
                Dette valget dokumenteres i rapporten under «Sikkerhet og dataintegritet».
              </BodyShort>

              <Button type="submit" size="small" variant="secondary">
                Lagre testkrav
              </Button>
            </VStack>
          </Form>
        </VStack>
      </Box>

      {/* Slack Configuration */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <HStack gap="space-8" align="center" justify="space-between">
            <HStack gap="space-8" align="center">
              <ChatIcon aria-hidden fontSize="1.25rem" />
              <div>
                <Heading size="small" level="2">
                  Slack-varsler
                </Heading>
                <BodyShort textColor="subtle" size="small">
                  Konfigurer Slack-varsler for uverifiserte deployments.
                </BodyShort>
              </div>
            </HStack>
            <Button
              as={Link}
              to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/slack`}
              variant="tertiary"
              size="small"
            >
              Se meldingshistorikk
            </Button>
          </HStack>

          <Form method="post">
            <input type="hidden" name="action" value="update_slack_config" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-16">
              <Switch name="slack_notifications_enabled" value="true" defaultChecked={app.slack_notifications_enabled}>
                Aktiver Slack-varsler for denne appen
              </Switch>

              <TextField
                label="Slack-kanal"
                name="slack_channel_id"
                defaultValue={app.slack_channel_id || ''}
                description="Kanal-ID (f.eks. C01234567) eller kanalnavn (f.eks. #min-kanal)"
                size="small"
                style={{ maxWidth: '300px' }}
              />

              <Button type="submit" size="small" variant="secondary">
                Lagre Slack-innstillinger
              </Button>
            </VStack>
          </Form>
        </VStack>
      </Box>

      {/* Deploy Notification Configuration */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small" level="2">
              Deployment-varsler
            </Heading>
            <BodyShort textColor="subtle" size="small">
              Send automatiske varsler til Slack når nye deployments oppdages. Inkluderer PR-tittel, hvem som opprettet,
              godkjente og merget PR-en.
            </BodyShort>
          </div>

          <Form method="post">
            <input type="hidden" name="action" value="update_slack_deploy_config" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-16">
              <Switch name="slack_deploy_notify_enabled" value="true" defaultChecked={app.slack_deploy_notify_enabled}>
                Aktiver deployment-varsler for denne appen
              </Switch>

              <TextField
                label="Slack-kanal for deployment-varsler"
                name="slack_deploy_channel_id"
                defaultValue={app.slack_deploy_channel_id || ''}
                description="Kanal-ID (f.eks. C01234567) eller kanalnavn (f.eks. #min-kanal). Kan være en annen kanal enn for avviksvarsler."
                size="small"
                style={{ maxWidth: '300px' }}
              />

              <Button type="submit" size="small" variant="secondary">
                Lagre deployment-varsler
              </Button>
            </VStack>
          </Form>
        </VStack>
      </Box>

      {/* Reminder Configuration */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small" level="2">
              Purring for ikke-godkjente deployments
            </Heading>
            <BodyShort textColor="subtle" size="small">
              Send automatiske påminnelser i Slack for deployments som mangler godkjenning.
            </BodyShort>
          </div>

          <Form method="post">
            <input type="hidden" name="action" value="update_reminder_config" />
            <input type="hidden" name="app_id" value={app.id} />
            <VStack gap="space-16">
              <Switch name="reminder_enabled" value="true" defaultChecked={app.reminder_enabled}>
                Aktiver automatisk purring
              </Switch>

              <TextField
                label="Tidspunkt"
                name="reminder_time"
                defaultValue={app.reminder_time || '09:00'}
                description="Klokkeslett for purring (HH:mm)"
                size="small"
                style={{ maxWidth: '150px' }}
              />

              <CheckboxGroup
                legend="Ukedager"
                description="Velg hvilke dager purringen skal sendes. Sendes kun på hverdager (ikke helligdager)."
                size="small"
                defaultValue={app.reminder_days || ['mon', 'tue', 'wed', 'thu', 'fri']}
              >
                <Checkbox name="reminder_days" value="mon">
                  Mandag
                </Checkbox>
                <Checkbox name="reminder_days" value="tue">
                  Tirsdag
                </Checkbox>
                <Checkbox name="reminder_days" value="wed">
                  Onsdag
                </Checkbox>
                <Checkbox name="reminder_days" value="thu">
                  Torsdag
                </Checkbox>
                <Checkbox name="reminder_days" value="fri">
                  Fredag
                </Checkbox>
              </CheckboxGroup>

              <Button type="submit" size="small" variant="secondary">
                Lagre purre-innstillinger
              </Button>
            </VStack>
          </Form>

          <HStack gap="space-8">
            <Form method="post">
              <input type="hidden" name="action" value="send_reminder" />
              <input type="hidden" name="team_slug" value={app.team_slug} />
              <input type="hidden" name="environment_name" value={app.environment_name} />
              <input type="hidden" name="app_name" value={app.app_name} />
              <Button type="submit" size="small" variant="tertiary">
                Send purring nå
              </Button>
            </Form>
          </HStack>
        </VStack>
      </Box>

      {/* Fetch Verification Data */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small" level="2">
              Hent verifiseringsdata fra GitHub
            </Heading>
            <BodyShort textColor="subtle" size="small">
              Henter og lagrer data fra GitHub for alle deployments. Kjører kun for deployments som mangler data eller
              har utdatert schema-versjon.
            </BodyShort>
          </div>

          {/* GitHub Data Stats */}
          <Box padding="space-16" borderRadius="4" background="neutral-soft">
            <VStack gap="space-8">
              <Label size="small">
                GitHub data-dekning{app.audit_start_year ? ` (fra ${app.audit_start_year})` : ''}
              </Label>
              <HStack gap="space-24" wrap>
                <div>
                  <Detail textColor="subtle">Totalt deployments</Detail>
                  <BodyShort weight="semibold">{githubDataStats.total}</BodyShort>
                </div>
                <div>
                  <Detail textColor="subtle">Med GitHub-data</Detail>
                  <BodyShort weight="semibold" style={{ color: 'var(--ax-text-success)' }}>
                    {githubDataStats.withCurrentData}
                  </BodyShort>
                </div>
                {githubDataStats.withOutdatedData > 0 && (
                  <div>
                    <Detail textColor="subtle">Utdatert data</Detail>
                    <BodyShort weight="semibold" style={{ color: 'var(--ax-text-warning)' }}>
                      {githubDataStats.withOutdatedData}
                    </BodyShort>
                  </div>
                )}
                <div>
                  <Detail textColor="subtle">Mangler data</Detail>
                  <BodyShort
                    weight="semibold"
                    style={{
                      color:
                        githubDataStats.withoutData > 0 ? 'var(--ax-text-danger)' : 'var(--ax-text-neutral-subtle)',
                    }}
                  >
                    {githubDataStats.withoutData}
                  </BodyShort>
                </div>
                {githubDataStats.total > 0 && (
                  <div>
                    <Detail textColor="subtle">Dekning</Detail>
                    <BodyShort weight="semibold">
                      {Math.round((githubDataStats.withCurrentData / githubDataStats.total) * 100)}%
                    </BodyShort>
                  </div>
                )}
              </HStack>
            </VStack>
          </Box>

          <HStack gap="space-16" align="center">
            <Form method="post">
              <input type="hidden" name="action" value="fetch_verification_data" />
              <input type="hidden" name="app_id" value={app.id} />
              <HStack gap="space-12" align="center">
                <Button
                  type="submit"
                  size="small"
                  variant="secondary"
                  loading={fetchJobStatus?.status === 'running'}
                  disabled={fetchJobStatus?.status === 'running'}
                >
                  {fetchJobStatus?.status === 'running' ? 'Henter data...' : 'Hent data for alle deployments'}
                </Button>
                {fetchJobStatus?.status !== 'running' && (
                  <Switch size="small" name="debug">
                    Debug-logging
                  </Switch>
                )}
              </HStack>
            </Form>
            {fetchJobStatus?.status === 'running' && (
              <Form method="post">
                <input type="hidden" name="action" value="cancel_fetch_job" />
                <input type="hidden" name="job_id" value={fetchJobStatus.id} />
                <Button type="submit" size="small" variant="danger">
                  Stopp
                </Button>
              </Form>
            )}
            {fetchJobStatus?.status === 'running' &&
              fetchJobStatus.lock_expires_at &&
              new Date(fetchJobStatus.lock_expires_at) < new Date() && (
                <Form method="post">
                  <input type="hidden" name="action" value="force_release_job" />
                  <input type="hidden" name="job_id" value={fetchJobStatus.id} />
                  <Button type="submit" size="small" variant="danger">
                    Tvangsfrigjør
                  </Button>
                </Form>
              )}
          </HStack>

          {fetchJobStatus && (
            <Box
              padding="space-12"
              borderRadius="4"
              background={
                fetchJobStatus.status === 'completed'
                  ? 'success-soft'
                  : fetchJobStatus.status === 'failed'
                    ? 'danger-soft'
                    : fetchJobStatus.status === 'cancelled'
                      ? 'warning-soft'
                      : fetchJobStatus.status === 'running'
                        ? 'info-soft'
                        : 'neutral-soft'
              }
            >
              <VStack gap="space-8">
                <HStack gap="space-8" align="center">
                  {fetchJobStatus.status === 'running' && <Loader size="xsmall" />}
                  {fetchJobStatus.status === 'completed' && <CheckmarkCircleIcon aria-hidden />}
                  {fetchJobStatus.status === 'failed' && <ExclamationmarkTriangleIcon aria-hidden />}
                  {fetchJobStatus.status === 'cancelled' && <ExclamationmarkTriangleIcon aria-hidden />}
                  <BodyShort size="small" weight="semibold">
                    {fetchJobStatus.status === 'pending' && 'Venter...'}
                    {fetchJobStatus.status === 'running' && 'Henter data fra GitHub...'}
                    {fetchJobStatus.status === 'completed' && 'Datahenting fullført'}
                    {fetchJobStatus.status === 'failed' && 'Datahenting feilet'}
                    {fetchJobStatus.status === 'cancelled' && 'Datahenting avbrutt'}
                  </BodyShort>
                </HStack>

                {/* Progress counters (shown for running AND terminal states) */}
                {fetchJobStatus.result && (
                  <HStack gap="space-16" wrap>
                    <Detail>
                      Prosessert: {(fetchJobStatus.result as Record<string, number>).processed ?? 0} /{' '}
                      {(fetchJobStatus.result as Record<string, number>).total ?? 0}
                    </Detail>
                    <Detail>Hentet: {(fetchJobStatus.result as Record<string, number>).fetched ?? 0}</Detail>
                    <Detail>Hoppet over: {(fetchJobStatus.result as Record<string, number>).skipped ?? 0}</Detail>
                    {((fetchJobStatus.result as Record<string, number>).errors ?? 0) > 0 && (
                      <Detail>
                        <span style={{ color: 'var(--ax-text-danger)' }}>
                          Feil: {(fetchJobStatus.result as Record<string, number>).errors}
                        </span>
                      </Detail>
                    )}
                  </HStack>
                )}

                {fetchJobStatus.status === 'failed' && fetchJobStatus.error && (
                  <BodyShort size="small">
                    <span style={{ color: 'var(--ax-text-danger)' }}>{fetchJobStatus.error}</span>
                  </BodyShort>
                )}

                <HStack gap="space-8" align="center">
                  <Detail textColor="subtle">
                    Startet:{' '}
                    {fetchJobStatus.started_at ? new Date(fetchJobStatus.started_at).toLocaleString('no-NO') : 'N/A'}
                    {fetchJobStatus.completed_at &&
                      ` • Fullført: ${new Date(fetchJobStatus.completed_at).toLocaleString('no-NO')}`}
                  </Detail>
                  {fetchJobStatus.id && (
                    <AkselLink
                      as={Link}
                      to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/sync-job/${fetchJobStatus.id}`}
                    >
                      <Detail>Se logg →</Detail>
                    </AkselLink>
                  )}
                </HStack>
              </VStack>
            </Box>
          )}
        </VStack>
      </Box>

      {/* Reverifisering */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small" level="2">
              Reverifisering
            </Heading>
            <BodyShort textColor="subtle" size="small">
              Sammenlign cached data med gjeldende verifiseringslogikk. Avvik kan godkjennes enkeltvis.
            </BodyShort>
          </div>
          <AkselLink
            as={Link}
            to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/verification-diff`}
          >
            Se verifiseringsavvik →
          </AkselLink>
          <AkselLink
            as={Link}
            to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/status-history`}
          >
            Se statusoverganger →
          </AkselLink>
        </VStack>
      </Box>

      {/* Avvik */}
      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <div>
            <Heading size="small" level="2">
              Avvik
            </Heading>
            <BodyShort textColor="subtle" size="small">
              Se og administrer registrerte avvik for deployments.
            </BodyShort>
          </div>
          <AkselLink
            as={Link}
            to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/deviations`}
          >
            Se avviksliste →
          </AkselLink>
        </VStack>
      </Box>

      {/* Recent config changes */}
      {recentConfigChanges.length > 0 && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16">
            <Label>Siste endringer</Label>
            <VStack gap="space-4">
              {recentConfigChanges.map((change) => (
                <Detail key={change.id} textColor="subtle">
                  {new Date(change.created_at).toLocaleString('no-NO')} -{' '}
                  {change.changed_by_name || change.changed_by_nav_ident}: {change.setting_key}
                </Detail>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}
    </VStack>
  )
}
