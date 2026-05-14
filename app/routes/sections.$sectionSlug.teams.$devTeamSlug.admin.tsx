import { useNavigation } from 'react-router'
import type { AddableApp } from '~/components/AddAppsDialog'
import { DevTeamAdminPage } from '~/components/DevTeamAdminPage'
import { updateImplicitApprovalSettings } from '~/db/app-settings.server'
import { type Board, createBoard, getBoardsByDevTeam } from '~/db/boards.server'
import { pool } from '~/db/connection.server'
import {
  addNaisTeamToDevTeam,
  type DevTeamApplication,
  getDevTeamApplications,
  getDevTeamBySlug,
  removeAppFromDevTeam,
  removeNaisTeamFromDevTeam,
  updateDevTeam,
} from '~/db/dev-teams.server'
import { createMonitoredApplication, getAllMonitoredApplications } from '~/db/monitored-applications.server'
import {
  assignTeamRole,
  getDevTeamMembersWithRoles,
  getTeamRoleAssignmentById,
  removeTeamRole,
} from '~/db/role-assignments.server'
import { getSectionBySlug } from '~/db/sections.server'
import { getAllUserMappings, getUserMappingByNavIdent } from '~/db/user-mappings.server'
import { fail, ok } from '~/lib/action-result'
import { requireUser } from '~/lib/auth.server'
import { canAssignTeamRole, resolveTeamAdminCapabilities } from '~/lib/authorization.server'
import { TEAM_ROLE_LABELS, TEAM_ROLES, type TeamRole } from '~/lib/authorization-types'
import { type BoardPeriodType, formatBoardLabel } from '~/lib/board-periods'
import { getFormString, isValidNavIdent, parseAuditStartYear } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { fetchAllTeamsAndApplications, getApplicationInfo } from '~/lib/nais.server'
import { type ImplicitApprovalMode, isImplicitApprovalMode } from '~/lib/verification/types'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug.admin'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Admin – ${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request)

  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }

  const section = await getSectionBySlug(params.sectionSlug)
  if (!section) {
    throw new Response('Seksjon ikke funnet', { status: 404 })
  }

  if (devTeam.section_slug !== section.slug) {
    throw new Response('Utviklingsteamet tilhører ikke denne seksjonen', { status: 404 })
  }

  const { canAccess, canAdmin } = await resolveTeamAdminCapabilities(user, devTeam.id)
  if (!canAccess) {
    throw new Response('Du har ikke tilgang til å administrere dette teamet', { status: 403 })
  }

  const [roleMembers, allUsers] = await Promise.all([getDevTeamMembersWithRoles(devTeam.id), getAllUserMappings()])

  let linkedApps: DevTeamApplication[] = []
  let addableApps: AddableApp[] = []
  let naisCatalogFailed = false
  let boards: Board[] = []

  if (canAdmin) {
    const [adminLinkedApps, allApps, naisCatalogResult, adminBoards] = await Promise.all([
      getDevTeamApplications(devTeam.id),
      getAllMonitoredApplications(),
      fetchAllTeamsAndApplications().then(
        (catalog) => ({ ok: true as const, catalog }),
        (err: unknown) => {
          logger.error('Kunne ikke hente Nais-katalog:', err)
          return {
            ok: false as const,
            catalog: [] as Array<{ teamSlug: string; appName: string; environmentName: string }>,
          }
        },
      ),
      getBoardsByDevTeam(devTeam.id),
    ])

    linkedApps = adminLinkedApps
    boards = adminBoards
    naisCatalogFailed = !naisCatalogResult.ok

    const naisCatalog = naisCatalogResult.catalog
    const naisTeamSlugs = devTeam.nais_team_slugs ?? []
    const directAppIds = new Set(linkedApps.map((a) => a.monitored_app_id))
    const teamApps = allApps.filter(
      (app) => app.is_active && (directAppIds.has(app.id) || naisTeamSlugs.includes(app.team_slug)),
    )
    const linkedKeys = new Set(teamApps.map((a) => `${a.team_slug}|${a.environment_name}|${a.app_name}`))
    const monitoredByKey = new Map(
      allApps.filter((a) => a.is_active).map((a) => [`${a.team_slug}|${a.environment_name}|${a.app_name}`, a.id]),
    )
    const allowedEnvs = process.env.ALLOWED_ENVIRONMENTS?.split(',').map((e) => e.trim()) || []
    const filteredCatalog =
      allowedEnvs.length > 0 ? naisCatalog.filter((a) => allowedEnvs.includes(a.environmentName)) : naisCatalog
    addableApps = filteredCatalog
      .filter((entry) => !linkedKeys.has(`${entry.teamSlug}|${entry.environmentName}|${entry.appName}`))
      .map((entry) => ({
        team_slug: entry.teamSlug,
        environment_name: entry.environmentName,
        app_name: entry.appName,
        monitored_id: monitoredByKey.get(`${entry.teamSlug}|${entry.environmentName}|${entry.appName}`) ?? null,
      }))
      .sort(
        (a, b) =>
          a.team_slug.localeCompare(b.team_slug, 'nb') ||
          a.app_name.localeCompare(b.app_name, 'nb') ||
          a.environment_name.localeCompare(b.environment_name, 'nb'),
      )
  }

  return {
    devTeam,
    roleMembers,
    linkedApps,
    addableApps,
    naisCatalogFailed,
    boards,
    canAdmin,
    sectionSlug: section.slug,
    allUsers: allUsers.flatMap((u) =>
      u.nav_ident ? [{ navIdent: u.nav_ident, displayName: u.display_name, githubUsername: u.github_username }] : [],
    ),
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)

  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }

  if (devTeam.section_slug !== params.sectionSlug) {
    throw new Response('Utviklingsteamet tilhører ikke denne seksjonen', { status: 404 })
  }

  if (!devTeam.is_active) {
    throw new Response('Utviklingsteamet er deaktivert', { status: 403 })
  }

  const formData = await request.formData()
  const intent = getFormString(formData, 'intent')

  // Role intents use canAssignTeamRole as sole gate (avoids double DB lookup)
  // All other intents require canAdmin via resolveTeamAdminCapabilities
  if (intent !== 'assign_role' && intent !== 'remove_role') {
    const { canAdmin } = await resolveTeamAdminCapabilities(user, devTeam.id)
    if (!canAdmin) {
      throw new Response('Du har ikke tilgang til å administrere dette teamet', { status: 403 })
    }
  }

  if (intent === 'assign_role') {
    const navIdent = getFormString(formData, 'nav_ident')?.toUpperCase()
    const role = getFormString(formData, 'role') as TeamRole

    if (!navIdent || !isValidNavIdent(navIdent)) {
      return fail('Ugyldig NAV-ident. Forventet format: én bokstav etterfulgt av 6 siffer (f.eks. A123456).')
    }

    if (!role || !TEAM_ROLES.includes(role)) {
      return fail(`Velg en gyldig rolle (${TEAM_ROLES.map((r) => TEAM_ROLE_LABELS[r]).join(', ')}).`)
    }

    if (!(await canAssignTeamRole(user, devTeam.id, role))) {
      throw new Response('Du har ikke tilgang til å tildele denne rollen', { status: 403 })
    }

    const userMapping = await getUserMappingByNavIdent(navIdent)
    if (!userMapping) {
      return fail(
        `Brukeren ${navIdent} er ikke kjent i systemet. Opprett en brukerkobling først under Admin → Brukermappinger.`,
      )
    }

    const roleLabel = TEAM_ROLE_LABELS[role] ?? role
    const result = await assignTeamRole(navIdent, devTeam.id, role, user.navIdent)
    if (!result) {
      return fail(`${navIdent} har allerede rollen ${roleLabel} i dette teamet.`)
    }
    return ok(`${navIdent} ble tildelt rollen ${roleLabel}.`)
  }

  if (intent === 'remove_role') {
    const assignmentId = Number(getFormString(formData, 'assignment_id'))
    if (!assignmentId || Number.isNaN(assignmentId)) {
      return fail('Ugyldig rolletildeling.')
    }

    const assignment = await getTeamRoleAssignmentById(assignmentId, devTeam.id)
    if (!assignment) {
      return fail('Kunne ikke fjerne rollen. Den kan allerede være fjernet.')
    }

    if (!(await canAssignTeamRole(user, devTeam.id, assignment.role))) {
      throw new Response('Du har ikke tilgang til å fjerne denne rollen', { status: 403 })
    }

    const removed = await removeTeamRole(assignmentId, user.navIdent, devTeam.id)
    if (!removed) {
      return fail('Kunne ikke fjerne rollen. Den kan allerede være fjernet.')
    }
    return ok('Rollen ble fjernet.')
  }

  if (intent === 'update_name') {
    const name = getFormString(formData, 'name')
    if (!name) {
      return fail('Teamnavn er påkrevd.')
    }
    try {
      await updateDevTeam(devTeam.id, { name })
      return ok('Teamnavn ble oppdatert.')
    } catch {
      return fail('Kunne ikke oppdatere teamnavn.')
    }
  }

  if (intent === 'add_nais_team') {
    const slug = getFormString(formData, 'slug')?.trim()
    if (!slug) {
      return fail('Nais-team slug er påkrevd.')
    }
    try {
      await addNaisTeamToDevTeam(devTeam.id, slug)
      return ok(`Nais-team "${slug}" ble lagt til.`)
    } catch {
      return fail('Kunne ikke legge til Nais-team.')
    }
  }

  if (intent === 'add_apps') {
    const refs = [...new Set(formData.getAll('app_ref').map(String))]
    const implicitApprovalModeRaw = getFormString(formData, 'implicit_approval_mode') ?? 'off'
    const existingIds = new Set<number>()
    const newKeys = new Map<string, { team_slug: string; environment_name: string; app_name: string }>()
    for (const ref of refs) {
      if (ref.startsWith('id:')) {
        const n = Number(ref.slice(3))
        if (Number.isInteger(n) && n > 0) existingIds.add(n)
      } else if (ref.startsWith('new:')) {
        const [team, env, app] = ref.slice(4).split('|')
        if (team && env && app) {
          newKeys.set(`${team}|${env}|${app}`, { team_slug: team, environment_name: env, app_name: app })
        }
      }
    }
    const newIdentities = [...newKeys.values()]

    if (existingIds.size === 0 && newIdentities.length === 0) {
      return fail('Velg minst én applikasjon å legge til.')
    }

    // Validate audit_start_year when there are new apps to create
    let auditStartYear = 0
    let implicitApprovalMode: ImplicitApprovalMode = 'off'
    if (newIdentities.length > 0) {
      const parsed = parseAuditStartYear(formData)
      if (typeof parsed === 'string') return fail(parsed)
      auditStartYear = parsed
      if (!isImplicitApprovalMode(implicitApprovalModeRaw)) {
        return fail('Ugyldig modus for implisitt godkjenning.')
      }
      implicitApprovalMode = implicitApprovalModeRaw
    }

    for (const id of newIdentities) {
      const found = await getApplicationInfo(id.team_slug, id.environment_name, id.app_name)
      if (!found) {
        return fail(
          `Fant ikke ${id.app_name} i Nais-team ${id.team_slug} (miljø ${id.environment_name}). Last siden på nytt og prøv igjen.`,
        )
      }
    }

    const client = await pool.connect()
    let transactionCommitted = false
    let clientReleased = false
    try {
      await client.query('BEGIN')
      const createdIds: number[] = []
      for (const id of newIdentities) {
        const app = await createMonitoredApplication(
          {
            team_slug: id.team_slug,
            environment_name: id.environment_name,
            app_name: id.app_name,
            audit_start_year: auditStartYear,
          },
          client,
        )
        createdIds.push(app.id)
      }
      for (const monitoredAppId of [...existingIds, ...createdIds]) {
        await client.query(
          `INSERT INTO dev_team_applications (dev_team_id, monitored_app_id)
           VALUES ($1, $2)
           ON CONFLICT (dev_team_id, monitored_app_id)
           DO UPDATE SET deleted_at = NULL, deleted_by = NULL
           WHERE dev_team_applications.deleted_at IS NOT NULL`,
          [devTeam.id, monitoredAppId],
        )
      }
      await client.query('COMMIT')
      transactionCommitted = true
      client.release()
      clientReleased = true

      if (createdIds.length > 0) {
        try {
          for (const monitoredAppId of createdIds) {
            await updateImplicitApprovalSettings({
              monitoredAppId,
              settings: { mode: implicitApprovalMode },
              changedByNavIdent: user.navIdent,
              changedByName: user.name || undefined,
            })
          }
        } catch (error) {
          logger.error('implicit approval setup failed for newly added apps:', error)
          return fail(
            'Applikasjonene ble lagt til, men klarte ikke å lagre oppsett for implisitt godkjenning. Sett dette på appens admin-side.',
          )
        }
      }

      const total = existingIds.size + createdIds.length
      const createdMsg =
        createdIds.length > 0
          ? ` (${createdIds.length} ny${createdIds.length === 1 ? '' : 'e'} app${createdIds.length === 1 ? '' : 'er'} lagt til overvåking)`
          : ''
      return ok(`La til ${total} applikasjon${total === 1 ? '' : 'er'}${createdMsg}.`)
    } catch (error) {
      if (!transactionCommitted) {
        await client.query('ROLLBACK').catch(() => {})
      }
      logger.error('add_apps tx failed:', error)
      return fail(`Kunne ikke legge til applikasjoner: ${error}`)
    } finally {
      if (!clientReleased) {
        client.release()
      }
    }
  }

  if (intent === 'remove_nais_team') {
    const slug = getFormString(formData, 'slug')
    if (!slug) {
      return fail('Nais-team slug er påkrevd.')
    }
    try {
      await removeNaisTeamFromDevTeam(devTeam.id, slug, user.navIdent)
      return ok(`Nais-team "${slug}" ble fjernet.`)
    } catch {
      return fail('Kunne ikke fjerne Nais-team.')
    }
  }

  if (intent === 'remove_app') {
    const appId = Number(getFormString(formData, 'app_id'))
    if (!Number.isInteger(appId) || appId <= 0) {
      return fail('Ugyldig applikasjons-ID.')
    }
    try {
      await removeAppFromDevTeam(devTeam.id, appId, user.navIdent)
      return ok('Applikasjon ble fjernet.')
    } catch {
      return fail('Kunne ikke fjerne applikasjon.')
    }
  }

  if (intent === 'create_board') {
    const periodType = getFormString(formData, 'period_type') as BoardPeriodType
    const periodLabel = getFormString(formData, 'period_label')
    const periodStart = getFormString(formData, 'period_start')
    const periodEnd = getFormString(formData, 'period_end')

    if (!periodType || !periodStart || !periodEnd || !periodLabel) {
      return fail('Alle felt er påkrevd.')
    }

    try {
      await createBoard({
        dev_team_id: devTeam.id,
        title: formatBoardLabel({ teamName: devTeam.name, periodLabel }),
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        period_label: periodLabel,
        created_by: user.navIdent,
      })
      return ok('Tavle ble opprettet.')
    } catch (error) {
      return fail(`Kunne ikke opprette tavle: ${error}`)
    }
  }

  return fail('Ukjent handling.')
}

export default function DevTeamAdmin({ loaderData, actionData }: Route.ComponentProps) {
  const { devTeam, roleMembers, linkedApps, addableApps, naisCatalogFailed, allUsers, boards, sectionSlug, canAdmin } =
    loaderData
  const navigation = useNavigation()
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`

  return (
    <DevTeamAdminPage
      devTeam={devTeam}
      roleMembers={roleMembers}
      linkedApps={linkedApps}
      addableApps={addableApps}
      naisCatalogFailed={naisCatalogFailed}
      boards={boards}
      canAdmin={canAdmin}
      allUsers={allUsers}
      teamBasePath={teamBasePath}
      isSubmitting={navigation.state === 'submitting'}
      actionData={actionData}
    />
  )
}
