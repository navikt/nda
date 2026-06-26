import { CogIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Heading, HStack, Loader, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { useFetcher, useNavigation, useRevalidator } from 'react-router'
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
import { AuditStartYearSettings } from '~/routes/team/$team.env.$env.app.$app.admin/AuditStartYearSettings'
import { Avvik } from '~/routes/team/$team.env.$env.app.$app.admin/Avvik'
import { DefaultBranchSettings } from '~/routes/team/$team.env.$env.app.$app.admin/DefaultBranchSettings'
import { DeployNotificationSettings } from '~/routes/team/$team.env.$env.app.$app.admin/DeployNotificationSettings'
import { FetchVerificationDataSection } from '~/routes/team/$team.env.$env.app.$app.admin/FetchVerificationDataSection'
import { ImplicitApprovalSettings } from '~/routes/team/$team.env.$env.app.$app.admin/ImplicitApprovalSettings'
import { RecentConfigChanges } from '~/routes/team/$team.env.$env.app.$app.admin/RecentConfigChanges'
import { ReminderSettings } from '~/routes/team/$team.env.$env.app.$app.admin/ReminderSettings'
import { Reverifisering } from '~/routes/team/$team.env.$env.app.$app.admin/Reverifisering'
import { SlackConfigSettings } from '~/routes/team/$team.env.$env.app.$app.admin/SlackConfigSettings'
import { TestRequirementSettings } from '~/routes/team/$team.env.$env.app.$app.admin/TestRequirementSettings'
import type { Route } from './+types/$team.env.$env.app.$app.admin'

export { action } from './$team.env.$env.app.$app.admin.actions.server'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.app ? `Admin - ${data.app.app_name}` : 'Admin' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAdmin(request)

  const { team, env, app: appName } = params

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

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

  const jobFetcher = useFetcher<{ status: string; error?: string }>()
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const [jobCompleted, setJobCompleted] = useState(false)

  const jobStatus = pendingJobId
    ? ((jobFetcher.data?.status as 'pending' | 'processing' | 'completed' | 'failed' | null) ?? 'pending')
    : null

  const [fetchJobId, setFetchJobId] = useState<number | null>(null)
  const [fetchJobStatus, setFetchJobStatus] = useState<SyncJob | null>(latestFetchJob)

  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  const readinessData = actionData?.readiness
  const readinessPeriodKey = actionData?.readinessPeriodKey as string | undefined
  const readinessUserMappings = (actionData?.userMappings as UserLookupMap) ?? {}

  useEffect(() => {
    if (actionData?.fetchJobStarted) {
      setFetchJobId(actionData.fetchJobStarted)
    }
  }, [actionData?.fetchJobStarted])

  useEffect(() => {
    if (actionData?.fetchJobStatus) {
      setFetchJobStatus(actionData.fetchJobStatus)
    }
  }, [actionData?.fetchJobStatus])

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

  useEffect(() => {
    if (latestFetchJob) {
      setFetchJobStatus(latestFetchJob)
    }
  }, [latestFetchJob])

  useEffect(() => {
    if (actionData?.jobStarted) {
      setPendingJobId(actionData.jobStarted)
      setJobError(null)
      setJobCompleted(false)
    }
  }, [actionData?.jobStarted])

  const jobFetcherLoadRef = useRef(jobFetcher.load)
  jobFetcherLoadRef.current = jobFetcher.load

  useEffect(() => {
    if (!pendingJobId) return

    const load = () => jobFetcherLoadRef.current(`/api/reports/status?jobId=${pendingJobId}`)

    load()

    const interval = setInterval(load, 2000)

    return () => clearInterval(interval)
  }, [pendingJobId])

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

      <ImplicitApprovalSettings app={app} implicitApprovalSettings={implicitApprovalSettings} />

      <TestRequirementSettings app={app} />

      <SlackConfigSettings app={app} />

      <DeployNotificationSettings app={app} />

      <ReminderSettings app={app} />

      <FetchVerificationDataSection app={app} githubDataStats={githubDataStats} fetchJobStatus={fetchJobStatus} />

      <Reverifisering app={app} />

      <Avvik app={app} />

      {recentConfigChanges.length > 0 && <RecentConfigChanges recentConfigChanges={recentConfigChanges} />}
    </VStack>
  )
}
