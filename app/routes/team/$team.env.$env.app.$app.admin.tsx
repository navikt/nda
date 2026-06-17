import { ChatIcon, CogIcon } from '@navikt/aksel-icons'
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
import { AuditReportGenerateSection } from '~/components/AuditReportGenerateSection'
import { AuditReportList } from '~/components/AuditReportList'
import { getAppConfigAuditLog, getImplicitApprovalSettings } from '~/db/app-settings.server'
import { getAuditReportsForAppAdmin } from '~/db/audit-reports.server'
import { getGitHubDataStatsForApp } from '~/db/github-data.server'
import { getMonitoredApplicationByIdentity } from '~/db/monitored-applications.server'
import { getLatestSyncJob, type SyncJob } from '~/db/sync-jobs.server'
import { getAllUsersWithAccounts } from '~/db/user-github-lookups.server'
import { requireAdmin } from '~/lib/auth.server'
import type { UserLookupMap } from '~/lib/user-display'
import {
  IMPLICIT_APPROVAL_MODE_DESCRIPTIONS,
  IMPLICIT_APPROVAL_MODE_LABELS,
  IMPLICIT_APPROVAL_MODES,
} from '~/lib/verification/types'
import { FetchVerificationDataSection } from '~/routes/team/$team.env.$env.app.$app.admin/FetchVerificationDataSection'
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

  const [implicitApprovalSettings, recentConfigChanges, auditReports, latestFetchJob, githubDataStats, userMappings] =
    await Promise.all([
      getImplicitApprovalSettings(app.id),
      getAppConfigAuditLog(app.id, { limit: 10 }),
      getAuditReportsForAppAdmin(app.id),
      getLatestSyncJob(app.id, 'fetch_verification_data'),
      getGitHubDataStatsForApp(app.id, app.audit_start_year),
      getAllUsersWithAccounts(),
    ])

  const displayNameMap: Record<string, string> = Object.fromEntries(
    userMappings.map((u) => [u.nav_ident.toUpperCase(), u.display_name]),
  )

  return {
    app,
    implicitApprovalSettings,
    recentConfigChanges,
    auditReports,
    isProdApp,
    latestFetchJob,
    githubDataStats,
    displayNameMap,
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
    displayNameMap,
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

  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  // Use action data for readiness (checked on demand)
  const readinessData = actionData?.readiness
  const readinessPeriodKey = actionData?.readinessPeriodKey as string | undefined
  const readinessUserMappings = (actionData?.userMappings as UserLookupMap) ?? {}

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

      {/* Audit Report Generation - only for prod apps */}
      {isProdApp && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-16">
            <div>
              <Heading size="small" level="2">
                Leveranserapport
              </Heading>
              <BodyShort textColor="subtle" size="small">
                Generer leveranserapport for revisjon. Rapporten dokumenterer four-eyes-prinsippet for alle deployments
                i valgt periode.
              </BodyShort>
            </div>

            <AuditReportGenerateSection
              appId={app.id}
              appUrl={appUrl}
              auditReports={auditReports}
              auditStartYear={app.audit_start_year ?? undefined}
              readinessData={readinessData}
              readinessPeriodKey={readinessPeriodKey}
              readinessUserMappings={readinessUserMappings}
              isCheckingReadiness={isSubmitting && navigation.formData?.get('action') === 'check_readiness'}
              isGeneratingReport={isSubmitting && navigation.formData?.get('action') === 'generate_report'}
              pendingJobId={pendingJobId}
            />

            {/* Existing reports for this app */}
            <AuditReportList reports={auditReports} appId={app.id} showArchiveActions displayNameMap={displayNameMap} />
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
                defaultValue={app.default_branch ?? ''}
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
                {IMPLICIT_APPROVAL_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {IMPLICIT_APPROVAL_MODE_LABELS[mode]}
                  </option>
                ))}
              </Select>

              <BodyShort size="small" textColor="subtle">
                <strong>{IMPLICIT_APPROVAL_MODE_LABELS.dependabot_only}:</strong>{' '}
                {IMPLICIT_APPROVAL_MODE_DESCRIPTIONS.dependabot_only}.
                <br />
                <strong>{IMPLICIT_APPROVAL_MODE_LABELS.all}:</strong> {IMPLICIT_APPROVAL_MODE_DESCRIPTIONS.all}.
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
                  Konfigurer Slack-varsler for ikke-godkjente deployments.
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

      <FetchVerificationDataSection app={app} githubDataStats={githubDataStats} fetchJobStatus={fetchJobStatus} />

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
          <AkselLink
            as={Link}
            to={`/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}/admin/sync-jobs`}
          >
            Se synk-jobber →
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
