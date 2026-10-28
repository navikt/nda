import { CogIcon } from '@navikt/aksel-icons'
import { Link as AkselLink, Alert, BodyShort, Box, Heading, HStack, Loader, VStack } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useNavigation, useRevalidator } from 'react-router'
import { AuditReportGenerateSection } from '~/components/AuditReportGenerateSection'
import { AuditReportList } from '~/components/AuditReportList'
import { NotFoundInNaisNotice } from '~/components/NotFoundInNaisNotice'
import { ReactivateAppNotice } from '~/components/ReactivateAppNotice'
import { getAppConfigAuditLog } from '~/db/app-settings.server'
import { getAuditReportsForAppAdmin } from '~/db/audit-reports.server'
import { getNaisApplyActivitySyncState } from '~/db/nais-apply-activity.server'
import { getEffectiveSettingsForApp, getRepositoryById } from '~/db/repositories.server'
import { getUsersByIdentifiers } from '~/db/user-github-lookups.server'
import type { AuditReportAssessmentModel } from '~/lib/audit-report-model'
import { requireAppAdminAccess, resolveRepositoryAdminAccess } from '~/lib/authorization.server'
import type { UserLookupMap } from '~/lib/user-display'
import { Avvik } from '~/routes/team/$team.env.$env.app.$app.admin/Avvik'
import { DeployNotificationSettings } from '~/routes/team/$team.env.$env.app.$app.admin/DeployNotificationSettings'
import { NaisApplySettings } from '~/routes/team/$team.env.$env.app.$app.admin/NaisApplySettings'
import { RecentConfigChanges } from '~/routes/team/$team.env.$env.app.$app.admin/RecentConfigChanges'
import { ReminderSettings } from '~/routes/team/$team.env.$env.app.$app.admin/ReminderSettings'
import { SlackConfigSettings } from '~/routes/team/$team.env.$env.app.$app.admin/SlackConfigSettings'
import { TestRequirementSettings } from '~/routes/team/$team.env.$env.app.$app.admin/TestRequirementSettings'
import type { Route } from './+types/$team.env.$env.app.$app.admin'

export { action } from './$team.env.$env.app.$app.admin.actions.server'

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: data?.app ? `Admin - ${data.app.app_name}` : 'Admin' }]
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { app, user } = await requireAppAdminAccess(request, params)

  const isProdApp = app.environment_name.startsWith('prod-')

  const [effectiveSettings, recentConfigChanges, applicationReports, repositoryReports, naisApplySyncState] =
    await Promise.all([
      getEffectiveSettingsForApp(app.id),
      getAppConfigAuditLog(app.id, { limit: 10 }),
      getAuditReportsForAppAdmin(app.id),
      getAuditReportsForAppAdmin(app.id, 'repository'),
      getNaisApplyActivitySyncState(app.id),
    ])
  const auditReports = [...applicationReports, ...repositoryReports]
  const auditStartYear = effectiveSettings.auditStartYear
  const repositoryId = effectiveSettings.repositoryId
  const repositoryRow = repositoryId !== null ? await getRepositoryById(repositoryId) : null
  const repoAdminAccess = repositoryRow !== null ? await resolveRepositoryAdminAccess(user, repositoryRow.id) : null
  const canAccessRepoAdminPage = repoAdminAccess?.authorized ?? false
  const affectedAppCount = canAccessRepoAdminPage ? (repoAdminAccess?.affectedApps.length ?? 0) : 0
  const repository =
    repositoryRow !== null && canAccessRepoAdminPage
      ? {
          id: repositoryRow.id,
          github_owner: repositoryRow.github_owner,
          github_repo_name: repositoryRow.github_repo_name,
        }
      : null
  const hasRepository = repositoryRow !== null

  const referencedNavIdents = Array.from(
    new Set(auditReports.flatMap((report) => [report.archived_by, report.superseded_by]).filter((id) => id != null)),
  )
  const userMappings = await getUsersByIdentifiers(referencedNavIdents)

  const displayNameMap: Record<string, string> = Object.fromEntries(
    Array.from(userMappings.entries())
      .filter(([, u]) => u.display_name != null)
      .map(([navIdent, u]) => [navIdent.toUpperCase(), u.display_name as string]),
  )

  return {
    app,
    auditStartYear,
    repository,
    hasRepository,
    affectedAppCount,
    canAccessRepoAdminPage,
    recentConfigChanges,
    auditReports,
    naisApplySyncState: {
      initialHistorySyncedAt: naisApplySyncState?.initial_history_synced_at?.toISOString() ?? null,
      lastSyncedAt: naisApplySyncState?.last_synced_at?.toISOString() ?? null,
      hasError: Boolean(naisApplySyncState?.last_error),
    },
    isProdApp,
    displayNameMap,
  }
}

export default function AppAdmin({ loaderData, actionData }: Route.ComponentProps) {
  const {
    app,
    auditStartYear,
    repository,
    hasRepository,
    affectedAppCount,
    canAccessRepoAdminPage,
    recentConfigChanges,
    auditReports,
    naisApplySyncState,
    isProdApp,
    displayNameMap,
  } = loaderData
  const navigation = useNavigation()
  const revalidator = useRevalidator()
  const isSubmitting = navigation.state === 'submitting'

  const jobFetcher = useFetcher<{ status: string; error?: string }>()
  const [pendingJobId, setPendingJobId] = useState<string | null>(null)
  const [pendingJobModel, setPendingJobModel] = useState<AuditReportAssessmentModel>('application')
  const [jobError, setJobError] = useState<string | null>(null)
  const [jobCompleted, setJobCompleted] = useState(false)

  const jobStatus = pendingJobId
    ? ((jobFetcher.data?.status as 'pending' | 'processing' | 'completed' | 'failed' | null) ?? 'pending')
    : null

  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  const readinessData = actionData?.readiness
  const readinessPeriodKey = actionData?.readinessPeriodKey as string | undefined
  const readinessUserMappings = (actionData?.userMappings as UserLookupMap) ?? {}

  useEffect(() => {
    if (actionData?.jobStarted) {
      setPendingJobId(actionData.jobStarted)
      setPendingJobModel(actionData.jobAssessmentModel ?? 'application')
      setJobError(null)
      setJobCompleted(false)
    }
  }, [actionData?.jobStarted, actionData?.jobAssessmentModel])

  const jobFetcherLoadRef = useRef(jobFetcher.load)
  jobFetcherLoadRef.current = jobFetcher.load

  useEffect(() => {
    if (!pendingJobId) return

    const load = () =>
      jobFetcherLoadRef.current(`/api/reports/status?jobId=${pendingJobId}&assessmentModel=${pendingJobModel}`)

    load()

    const interval = setInterval(load, 2000)

    return () => clearInterval(interval)
  }, [pendingJobId, pendingJobModel])

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
              auditStartYear={auditStartYear ?? undefined}
              readinessData={readinessData}
              repositoryReadiness={actionData?.repositoryReadiness}
              readinessAssessmentModel={actionData?.readinessAssessmentModel}
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

      {!app.is_active && <ReactivateAppNotice canReactivate appId={app.id} />}

      {app.not_found_in_nais_at && <NotFoundInNaisNotice variant="panel" canDeactivate appId={app.id} />}

      <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
        <VStack gap="space-16">
          <Heading size="small" level="2">
            Repository-innstillinger
          </Heading>
          {repository && canAccessRepoAdminPage ? (
            <BodyShort textColor="subtle" size="small">
              Default branch, startår for revisjon og implisitt godkjenning administreres nå på repo-siden, siden de
              gjelder hele GitHub-repoet
              {affectedAppCount > 1 ? ` og alle ${affectedAppCount} appene som deployes fra det` : ''}.{' '}
              <AkselLink
                as={Link}
                to={`/repository/${repository.github_owner}/${repository.github_repo_name}/admin?repositoryId=${repository.id}`}
              >
                Gå til repository-administrasjon
              </AkselLink>
            </BodyShort>
          ) : hasRepository ? (
            <Alert variant="info" size="small">
              Du har ikke tilgang til å administrere repository-innstillinger for dette repoet.
            </Alert>
          ) : (
            <Alert variant="info" size="small">
              Denne appen har ikke et kjent GitHub-repository koblet til seg, så repository-innstillinger kan ikke
              konfigureres.
            </Alert>
          )}
        </VStack>
      </Box>

      <TestRequirementSettings app={app} />

      <SlackConfigSettings app={app} />

      <DeployNotificationSettings app={app} />

      <NaisApplySettings appId={app.id} enabled={app.nais_apply_enabled} syncState={naisApplySyncState} />

      <ReminderSettings app={app} />

      <Avvik app={app} />

      {recentConfigChanges.length > 0 && <RecentConfigChanges recentConfigChanges={recentConfigChanges} />}
    </VStack>
  )
}
