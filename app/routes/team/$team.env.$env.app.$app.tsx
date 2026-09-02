import { useActionData, useLoaderData } from 'react-router'
import { AppDetailPage } from '~/components/AppDetailPage'
import { getUnresolvedAlertsByApp, resolveRepositoryAlert } from '~/db/alerts.server'
import { updateImplicitApprovalSettings } from '~/db/app-settings.server'
import {
  approveRepository,
  getRepositoriesByAppId,
  rejectRepository,
  setRepositoryAsActive,
} from '~/db/application-repositories.server'
import { getAuditReportsForApp } from '~/db/audit-reports.server'
import { getAppDeploymentStats, getPendingVerificationCount } from '~/db/deployments.server'
import { getDevTeamsForApp } from '~/db/dev-teams.server'
import { getMonitoredApplicationByIdentity, updateMonitoredApplication } from '~/db/monitored-applications.server'
import { getMonorepoSiblings } from '~/db/monorepo.server'
import { getLatestSyncJob, getObservedSyncIntervalMs, SYNC_INTERVAL_MS } from '~/db/sync-jobs.server'
import { getUserIdentity } from '~/lib/auth.server'
import { canAccessAppAdmin, resolveAppCapabilities } from '~/lib/authorization.server'
import { logger } from '~/lib/logger.server'
import { requireTeamEnvAppParams } from '~/lib/route-params.server'
import { VERIFY_LIMIT_PER_APP } from '~/lib/sync'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import { isImplicitApprovalMode } from '~/lib/verification/types'
import type { Route } from './+types/$team.env.$env.app.$app'

export async function loader({ params, request, url }: Route.LoaderArgs) {
  const { team, env, app: appName } = requireTeamEnvAppParams(params)

  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod

  const range = getDateRangeForPeriod(period)
  const startDate = range?.startDate
  const endDate = range?.endDate

  const app = await getMonitoredApplicationByIdentity(team, env, appName)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }

  const identity = await getUserIdentity(request)

  const [
    capabilities,
    canAccessAdmin,
    repositories,
    deploymentStats,
    alerts,
    auditReports,
    monorepo,
    devTeams,
    latestSyncJob,
    verificationProgress,
    observedVerifyIntervalMs,
  ] = await Promise.all([
    (app.not_found_in_nais_at || !app.is_active) && identity ? resolveAppCapabilities(identity, app.id) : null,
    identity ? canAccessAppAdmin(identity, app.id) : false,
    getRepositoriesByAppId(app.id),
    getAppDeploymentStats(app.id, startDate, endDate, app.audit_start_year),
    getUnresolvedAlertsByApp(app.id),
    getAuditReportsForApp(app.id),
    getMonorepoSiblings(app.id),
    getDevTeamsForApp(app.id, team),
    getLatestSyncJob(app.id, 'nais_sync'),
    getPendingVerificationCount(app.id),
    getObservedSyncIntervalMs(app.id, 'github_verify'),
  ])

  const canDeactivate = app.not_found_in_nais_at ? (capabilities?.canDeactivate ?? false) : false
  const canReactivate = !app.is_active ? (capabilities?.canReactivate ?? false) : false

  const activeRepo = repositories.find((r) => r.status === 'active')
  const pendingRepos = repositories.filter((r) => r.status === 'pending_approval')
  const historicalRepos = repositories.filter((r) => r.status === 'historical')

  const verifyLimitPerCycle = VERIFY_LIMIT_PER_APP
  const syncIntervalMs = observedVerifyIntervalMs ?? SYNC_INTERVAL_MS

  return {
    app,
    canDeactivate,
    canReactivate,
    canAccessAdmin,
    repositories,
    activeRepo,
    pendingRepos,
    historicalRepos,
    deploymentStats,
    alerts,
    auditReports,
    monorepo,
    devTeams,
    latestSyncJob: latestSyncJob
      ? {
          status: latestSyncJob.status,
          started_at: latestSyncJob.started_at,
          completed_at: latestSyncJob.completed_at,
          created_at: latestSyncJob.created_at,
        }
      : null,
    verificationProgress,
    verifyLimitPerCycle,
    syncIntervalMs,
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `${data?.app?.app_name ?? 'App'} - NDA` }]
}

export async function action({ params, request }: Route.ActionArgs) {
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
      const modeValue = formData.get('mode')

      if (!identity) {
        return { error: 'Du må være innlogget for å endre innstillinger' }
      }

      if (typeof modeValue !== 'string' || !isImplicitApprovalMode(modeValue)) {
        return { error: 'Ugyldig modus valgt' }
      }

      await updateImplicitApprovalSettings({
        monitoredAppId: appId,
        settings: { mode: modeValue },
        changedByNavIdent: identity.navIdent,
        changedByName: identity.name || undefined,
      })

      return { success: 'Implisitt godkjenning-innstillinger oppdatert!' }
    }

    if (action === 'update_audit_start_year') {
      const appId = parseInt(formData.get('app_id') as string, 10)
      const startYearValue = formData.get('audit_start_year') as string

      const auditStartYear = startYearValue?.trim() ? parseInt(startYearValue, 10) : null

      if (auditStartYear !== null && (Number.isNaN(auditStartYear) || auditStartYear < 2000 || auditStartYear > 2100)) {
        return { error: 'Ugyldig årstall (må være mellom 2000 og 2100)' }
      }

      await updateMonitoredApplication(appId, { audit_start_year: auditStartYear })
      return {
        success: auditStartYear ? `Startår oppdatert til ${auditStartYear}` : 'Startår fjernet',
      }
    }

    if (action === 'deactivate_app') {
      if (!identity) {
        return { error: 'Du må være innlogget for å deaktivere applikasjonen' }
      }

      const { team, env, app: appName } = requireTeamEnvAppParams(params)
      const targetApp = await getMonitoredApplicationByIdentity(team, env, appName)
      if (!targetApp) {
        return { error: 'Applikasjonen finnes ikke' }
      }
      if (!targetApp.not_found_in_nais_at) {
        return { error: 'Applikasjonen er ikke markert som ikke funnet i Nais' }
      }

      const { canDeactivate } = await resolveAppCapabilities(identity, targetApp.id)
      if (!canDeactivate) {
        return { error: 'Du har ikke tilgang til å deaktivere denne applikasjonen' }
      }

      await updateMonitoredApplication(targetApp.id, { is_active: false })
      return { success: 'Applikasjonen ble deaktivert' }
    }

    if (action === 'reactivate_app') {
      if (!identity) {
        return { error: 'Du må være innlogget for å reaktivere applikasjonen' }
      }

      const { team, env, app: appName } = requireTeamEnvAppParams(params)
      const targetApp = await getMonitoredApplicationByIdentity(team, env, appName)
      if (!targetApp) {
        return { error: 'Applikasjonen finnes ikke' }
      }
      if (targetApp.is_active) {
        return { error: 'Applikasjonen er allerede aktiv' }
      }

      const { canReactivate } = await resolveAppCapabilities(identity, targetApp.id)
      if (!canReactivate) {
        return { error: 'Du har ikke tilgang til å reaktivere denne applikasjonen' }
      }

      await updateMonitoredApplication(targetApp.id, { is_active: true, not_found_in_nais_at: null })
      return { success: 'Applikasjonen ble reaktivert' }
    }

    return { error: 'Ukjent handling' }
  } catch (error) {
    logger.error('Action error:', error)
    return { error: error instanceof Error ? error.message : 'En feil oppstod' }
  }
}

export default function AppDetailRoute() {
  const loaderData = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()

  return <AppDetailPage loaderData={loaderData} actionData={actionData} canAccessAdmin={loaderData.canAccessAdmin} />
}
