import { CogIcon } from '@navikt/aksel-icons'
import {
  Link as AkselLink,
  Alert,
  BodyShort,
  Box,
  Button,
  Detail,
  Heading,
  HStack,
  Label,
  Loader,
  Select,
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
import type { SyncJob } from '~/db/sync-job-types'
import { getLatestSyncJob } from '~/db/sync-jobs.server'
import { getAllUsersWithAccounts } from '~/db/user-github-lookups.server'
import { requireAdmin } from '~/lib/auth.server'
import type { UserLookupMap } from '~/lib/user-display'
import {
  IMPLICIT_APPROVAL_MODE_DESCRIPTIONS,
  IMPLICIT_APPROVAL_MODE_LABELS,
  IMPLICIT_APPROVAL_MODES,
} from '~/lib/verification/types'
import { AuditStartYearSettings } from '~/routes/team/$team.env.$env.app.$app.admin/AuditStartYearSettings'
import { DefaultBranchSettings } from '~/routes/team/$team.env.$env.app.$app.admin/DefaultBranchSettings'
import { DeployNotificationSettings } from '~/routes/team/$team.env.$env.app.$app.admin/DeployNotificationSettings'
import { FetchVerificationDataSection } from '~/routes/team/$team.env.$env.app.$app.admin/FetchVerificationDataSection'
import { ReminderSettings } from '~/routes/team/$team.env.$env.app.$app.admin/ReminderSettings'
import { SlackConfigSettings } from '~/routes/team/$team.env.$env.app.$app.admin/SlackConfigSettings'
import { TestRequirementSettings } from '~/routes/team/$team.env.$env.app.$app.admin/TestRequirementSettings'
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

      <DefaultBranchSettings app={app} />

      <AuditStartYearSettings app={app} />

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

      <TestRequirementSettings app={app} />

      <SlackConfigSettings app={app} />

      <DeployNotificationSettings app={app} />

      <ReminderSettings app={app} />

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
