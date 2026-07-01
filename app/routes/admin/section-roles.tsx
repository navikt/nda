import { BodyShort, Heading, VStack } from '@navikt/ds-react'
import { useLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { SectionRolesTable } from '~/components/SectionRolesTable'
import {
  assignSectionRole,
  getSectionRoleAssignmentById,
  getUserRoles,
  removeSectionRole,
} from '~/db/role-assignments.server'
import type { Section } from '~/db/sections.server'
import { getAllUsersWithAccounts, getOrCreateUserFromGraph } from '~/db/user-github-lookups.server'
import { fail, ok } from '~/lib/action-result'
import { requireUser } from '~/lib/auth.server'
import { canManageSection } from '~/lib/authorization.server'
import { SECTION_ROLES, type SectionRole } from '~/lib/authorization-types'
import { getFormString, isValidNavIdent } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import type { Route } from './+types/section-roles'

const ROLE_LABELS: Record<SectionRole, string> = {
  teknologileder: 'Teknologileder',
  seksjonsleder: 'Seksjonsleder',
  leveranseleder: 'Leveranseleder',
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Seksjonsroller – Admin' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request)
  const { pool } = await import('~/db/connection.server')

  const isAdmin = user.role === 'admin'

  let sectionIds: number[] | null = null
  if (!isAdmin) {
    const { sectionRoles } = await getUserRoles(user.navIdent)
    const managingIds = [
      ...new Set(
        sectionRoles.filter((r) => r.role === 'seksjonsleder' || r.role === 'teknologileder').map((r) => r.section_id),
      ),
    ]
    if (managingIds.length === 0) throw new Response('Ingen tilgang', { status: 403 })
    sectionIds = managingIds
  }

  const sectionsResult = sectionIds
    ? await pool.query<Section>('SELECT * FROM sections WHERE is_active = true AND id = ANY($1) ORDER BY name', [
        sectionIds,
      ])
    : await pool.query<Section>('SELECT * FROM sections WHERE is_active = true ORDER BY name')
  const sections = sectionsResult.rows

  const { rows: allAssignments } = sectionIds
    ? await pool.query<{
        id: number
        nav_ident: string
        section_id: number
        role: string
        assigned_by: string
        assigned_at: Date
      }>(
        `SELECT r.id, r.nav_ident, r.section_id, r.role, r.assigned_by, r.assigned_at
         FROM section_role_assignments r
         JOIN sections s ON s.id = r.section_id AND s.is_active = true
         WHERE r.deleted_at IS NULL AND r.section_id = ANY($1)
         ORDER BY s.name, r.role, r.nav_ident`,
        [sectionIds],
      )
    : await pool.query<{
        id: number
        nav_ident: string
        section_id: number
        role: string
        assigned_by: string
        assigned_at: Date
      }>(
        `SELECT r.id, r.nav_ident, r.section_id, r.role, r.assigned_by, r.assigned_at
         FROM section_role_assignments r
         JOIN sections s ON s.id = r.section_id AND s.is_active = true
         WHERE r.deleted_at IS NULL
         ORDER BY s.name, r.role, r.nav_ident`,
      )

  const userMappings = await getAllUsersWithAccounts()
  const displayNameMap = Object.fromEntries(userMappings.map((u) => [u.nav_ident.toUpperCase(), u.display_name]))

  return { sections, assignments: allAssignments, displayNameMap }
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request)
  const formData = await request.formData()
  const intent = getFormString(formData, 'intent')

  if (intent === 'assign') {
    const navIdent = getFormString(formData, 'nav_ident')?.toUpperCase()
    const sectionId = Number(getFormString(formData, 'section_id'))
    const role = getFormString(formData, 'role') as SectionRole

    if (!navIdent || !isValidNavIdent(navIdent)) {
      return fail('Ugyldig NAV-ident. Forventet format: én bokstav etterfulgt av 6 siffer (f.eks. A123456).')
    }

    if (!sectionId || Number.isNaN(sectionId)) {
      return fail('Velg en seksjon.')
    }
    if (!role || !SECTION_ROLES.includes(role)) {
      return fail('Velg en gyldig rolle.')
    }

    if (!(await canManageSection(user, sectionId))) {
      return fail('Du har ikke tilgang til å tildele roller i denne seksjonen.')
    }

    const sections = await (async () => {
      const { pool } = await import('~/db/connection.server')
      const result = await pool.query<Section>('SELECT id FROM sections WHERE is_active = true AND id = $1', [
        sectionId,
      ])
      return result.rows
    })()
    if (sections.length === 0) {
      return fail('Seksjonen finnes ikke eller er deaktivert.')
    }

    let userMapping: Awaited<ReturnType<typeof getOrCreateUserFromGraph>>
    try {
      userMapping = await getOrCreateUserFromGraph(navIdent)
    } catch (err) {
      logger.error(`Feil ved brukeropprettelse for ${navIdent}:`, err instanceof Error ? err : new Error(String(err)))
      return fail(`Kunne ikke opprette brukeren ${navIdent}. Prøv igjen senere.`)
    }
    if (!userMapping) {
      return fail(`Brukeren ${navIdent} ble ikke funnet i Active Directory eller mangler visningsnavn.`)
    }

    const result = await assignSectionRole(navIdent, sectionId, role, user.navIdent)
    if (!result) {
      return fail(`${navIdent} har allerede rollen ${ROLE_LABELS[role]} i denne seksjonen.`)
    }
    return ok(`${navIdent} ble tildelt rollen ${ROLE_LABELS[role]}.`)
  }

  if (intent === 'remove') {
    const assignmentId = Number(getFormString(formData, 'assignment_id'))
    if (!assignmentId || Number.isNaN(assignmentId)) {
      return fail('Ugyldig rolletildeling.')
    }

    const assignment = await getSectionRoleAssignmentById(assignmentId)
    if (!assignment || !(await canManageSection(user, assignment.section_id))) {
      return fail('Kunne ikke fjerne rollen. Den kan allerede være fjernet.')
    }

    const removed = await removeSectionRole(assignmentId, user.navIdent)
    if (!removed) {
      return fail('Kunne ikke fjerne rollen. Den kan allerede være fjernet.')
    }
    return ok('Rollen ble fjernet.')
  }

  return fail('Ukjent handling.')
}

export default function SectionRolesAdmin({ actionData }: Route.ComponentProps) {
  const { sections, assignments, displayNameMap } = useLoaderData<typeof loader>()

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Seksjonsroller
        </Heading>
        <BodyShort textColor="subtle">
          Tildel og fjern roller på seksjonsnivå (Teknologileder, Seksjonsleder, Leveranseleder).
        </BodyShort>
      </div>

      <ActionAlert data={actionData} />

      <SectionRolesTable sections={sections} assignments={assignments} displayNameMap={displayNameMap} />
    </VStack>
  )
}
