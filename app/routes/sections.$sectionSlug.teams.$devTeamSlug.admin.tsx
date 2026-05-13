import { PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Heading,
  HStack,
  Modal,
  Select,
  Table,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useMemo, useRef, useState } from 'react'
import { Form, Link, useLoaderData, useNavigation } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { RoleMembersSection } from '~/components/RoleMembersSection'
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
import { getAllMonitoredApplications } from '~/db/monitored-applications.server'
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
import { TEAM_ROLES, type TeamRole } from '~/lib/authorization-types'
import { type BoardPeriodType, formatBoardLabel, getPeriodsForYear } from '~/lib/board-periods'
import { getFormString, isValidNavIdent } from '~/lib/form-validators'
import { logger } from '~/lib/logger.server'
import { fetchAllTeamsAndApplications, getApplicationInfo } from '~/lib/nais.server'
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
      return fail('Velg en gyldig rolle (produktleder eller utvikler).')
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

    const result = await assignTeamRole(navIdent, devTeam.id, role, user.navIdent)
    if (!result) {
      return fail(
        `${navIdent} har allerede rollen ${role === 'produktleder' ? 'Produktleder' : 'Utvikler'} i dette teamet.`,
      )
    }
    return ok(`${navIdent} ble tildelt rollen ${role === 'produktleder' ? 'Produktleder' : 'Utvikler'}.`)
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

    for (const id of newIdentities) {
      const found = await getApplicationInfo(id.team_slug, id.environment_name, id.app_name)
      if (!found) {
        return fail(
          `Fant ikke ${id.app_name} i Nais-team ${id.team_slug} (miljø ${id.environment_name}). Last siden på nytt og prøv igjen.`,
        )
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const createdIds: number[] = []
      for (const id of newIdentities) {
        const result = await client.query<{ id: number }>(
          `INSERT INTO monitored_applications (team_slug, environment_name, app_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (team_slug, environment_name, app_name)
           DO UPDATE SET is_active = true, updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [id.team_slug, id.environment_name, id.app_name],
        )
        createdIds.push(result.rows[0].id)
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
      const total = existingIds.size + createdIds.length
      const createdMsg =
        createdIds.length > 0
          ? ` (${createdIds.length} ny${createdIds.length === 1 ? '' : 'e'} app${createdIds.length === 1 ? '' : 'er'} lagt til overvåking)`
          : ''
      return ok(`La til ${total} applikasjon${total === 1 ? '' : 'er'}${createdMsg}.`)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      logger.error('add_apps tx failed:', error)
      return fail(`Kunne ikke legge til applikasjoner: ${error}`)
    } finally {
      client.release()
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

type AddableApp = {
  team_slug: string
  environment_name: string
  app_name: string
  monitored_id: number | null
}

export default function DevTeamAdmin({ actionData }: Route.ComponentProps) {
  const { devTeam, roleMembers, linkedApps, addableApps, naisCatalogFailed, allUsers, boards, sectionSlug, canAdmin } =
    useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          Administrer {devTeam.name}
        </Heading>
        <BodyShort textColor="subtle">
          {canAdmin ? 'Administrer medlemmer, applikasjoner og Nais-team.' : 'Administrer roller for teamet.'}
        </BodyShort>
      </div>

      <ActionAlert data={actionData} />

      {canAdmin && <BoardsSection teamName={devTeam.name} boards={boards} teamBasePath={teamBasePath} />}
      {canAdmin && <TeamNameSection name={devTeam.name} />}
      <RoleMembersSection roleMembers={roleMembers} allUsers={allUsers} />
      {canAdmin && <NaisTeamsSection naisTeamSlugs={devTeam.nais_team_slugs} />}
      {canAdmin && (
        <ApplicationsSection
          linkedApps={linkedApps}
          addableApps={addableApps}
          naisCatalogFailed={naisCatalogFailed}
          isSubmitting={navigation.state === 'submitting'}
        />
      )}
    </VStack>
  )
}

function BoardsSection({
  teamName,
  boards,
  teamBasePath,
}: {
  teamName: string
  boards: Board[]
  teamBasePath: string
}) {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <Heading level="2" size="medium">
          Tavler
        </Heading>
        {!showCreate && (
          <Button variant="tertiary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
            Ny tavle
          </Button>
        )}
      </HStack>
      {showCreate && <CreateBoardForm teamName={teamName} onCancel={() => setShowCreate(false)} />}
      {boards.length > 0 ? (
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tittel</Table.HeaderCell>
              <Table.HeaderCell>Periode</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {boards.map((board) => (
              <Table.Row key={board.id}>
                <Table.DataCell>{formatBoardLabel({ teamName, periodLabel: board.period_label })}</Table.DataCell>
                <Table.DataCell>
                  {new Date(board.period_start).toLocaleDateString('nb-NO', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  {' – '}
                  {new Date(board.period_end).toLocaleDateString('nb-NO', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Table.DataCell>
                <Table.DataCell>
                  <Tag variant={board.is_active ? 'success' : 'neutral'} size="xsmall">
                    {board.is_active ? 'Aktiv' : 'Avsluttet'}
                  </Tag>
                </Table.DataCell>
                <Table.DataCell align="right">
                  <HStack gap="space-4" justify="end">
                    <Button
                      as={Link}
                      to={`${teamBasePath}/dashboard?periodType=${board.period_type}&period=${encodeURIComponent(board.period_label)}`}
                      variant="tertiary"
                      size="xsmall"
                    >
                      Åpne tavle
                    </Button>
                    <Button as={Link} to={`${teamBasePath}/${board.id}`} variant="tertiary" size="xsmall">
                      Rediger
                    </Button>
                  </HStack>
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : (
        <BodyShort textColor="subtle">Ingen tavler er opprettet ennå.</BodyShort>
      )}
    </VStack>
  )
}

function CreateBoardForm({ teamName, onCancel }: { teamName: string; onCancel: () => void }) {
  const [periodType, setPeriodType] = useState<BoardPeriodType>('tertiary')
  const year = new Date().getFullYear()
  const periods = getPeriodsForYear(periodType, year)

  const [selectedPeriod, setSelectedPeriod] = useState(periods[0])

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <Form method="post" onSubmit={onCancel}>
        <input type="hidden" name="intent" value="create_board" />
        <input type="hidden" name="period_start" value={selectedPeriod?.start ?? ''} />
        <input type="hidden" name="period_end" value={selectedPeriod?.end ?? ''} />
        <input type="hidden" name="period_label" value={selectedPeriod?.label ?? ''} />
        <VStack gap="space-16">
          <Heading level="3" size="small">
            Opprett ny tavle
          </Heading>
          <BodyShort size="small" textColor="subtle">
            Tavlen får tittelen «{formatBoardLabel({ teamName, periodLabel: selectedPeriod?.label ?? '' })}».
          </BodyShort>
          <HStack gap="space-16" wrap>
            <Select
              label="Periodetype"
              name="period_type"
              size="small"
              value={periodType}
              onChange={(e) => {
                const type = e.target.value as BoardPeriodType
                setPeriodType(type)
                const newPeriods = getPeriodsForYear(type, year)
                setSelectedPeriod(newPeriods[0])
              }}
            >
              <option value="tertiary">Tertial</option>
              <option value="quarterly">Kvartal</option>
            </Select>
            <Select
              label="Periode"
              size="small"
              value={selectedPeriod?.label ?? ''}
              onChange={(e) => {
                const p = periods.find((p) => p.label === e.target.value)
                if (p) setSelectedPeriod(p)
              }}
            >
              {periods.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </Select>
          </HStack>
          <HStack gap="space-8">
            <Button type="submit" size="small">
              Opprett
            </Button>
            <Button variant="tertiary" size="small" onClick={onCancel}>
              Avbryt
            </Button>
          </HStack>
        </VStack>
      </Form>
    </Box>
  )
}

function TeamNameSection({ name }: { name: string }) {
  const [editing, setEditing] = useState(false)

  return (
    <VStack gap="space-16">
      <Heading level="2" size="medium">
        Teamnavn
      </Heading>
      {editing ? (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post" onSubmit={() => setEditing(false)}>
            <input type="hidden" name="intent" value="update_name" />
            <VStack gap="space-12">
              <TextField label="Teamnavn" name="name" size="small" defaultValue={name} autoComplete="off" />
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Lagre
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setEditing(false)}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Box>
      ) : (
        <HStack gap="space-12" align="center">
          <Tag variant="neutral">{name}</Tag>
          <Button variant="tertiary" size="small" onClick={() => setEditing(true)}>
            Endre
          </Button>
        </HStack>
      )}
    </VStack>
  )
}

function NaisTeamsSection({ naisTeamSlugs }: { naisTeamSlugs: string[] }) {
  const modalRef = useRef<HTMLDialogElement>(null)
  const [newSlug, setNewSlug] = useState('')

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <Heading level="2" size="medium">
          Nais-team ({naisTeamSlugs.length})
        </Heading>
        <Button
          variant="tertiary"
          size="small"
          icon={<PlusIcon aria-hidden />}
          onClick={() => modalRef.current?.showModal()}
        >
          Legg til Nais-team
        </Button>
      </HStack>

      {naisTeamSlugs.length > 0 ? (
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Slug</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {naisTeamSlugs.map((slug) => (
              <Table.Row key={slug}>
                <Table.DataCell>
                  <code>{slug}</code>
                </Table.DataCell>
                <Table.DataCell>
                  <Form method="post" style={{ display: 'inline' }}>
                    <input type="hidden" name="intent" value="remove_nais_team" />
                    <input type="hidden" name="slug" value={slug} />
                    <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
                      Fjern
                    </Button>
                  </Form>
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : (
        <Alert variant="info" size="small">
          Ingen Nais-team er koblet til ennå.
        </Alert>
      )}

      <Modal ref={modalRef} header={{ heading: 'Legg til Nais-team' }} closeOnBackdropClick>
        <Modal.Body>
          <Form
            method="post"
            onSubmit={() => {
              modalRef.current?.close()
              setNewSlug('')
            }}
          >
            <input type="hidden" name="intent" value="add_nais_team" />
            <VStack gap="space-16">
              <TextField
                label="Nais-team slug"
                name="slug"
                size="small"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="F.eks. pensjondeployer"
                autoComplete="off"
              />
              <HStack gap="space-8">
                <Button type="submit" size="small" icon={<PlusIcon aria-hidden />} disabled={!newSlug.trim()}>
                  Legg til
                </Button>
                <Button
                  variant="tertiary"
                  size="small"
                  type="button"
                  onClick={() => {
                    modalRef.current?.close()
                    setNewSlug('')
                  }}
                >
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Modal.Body>
      </Modal>
    </VStack>
  )
}

function ApplicationsSection({
  linkedApps,
  addableApps,
  naisCatalogFailed,
  isSubmitting,
}: {
  linkedApps: DevTeamApplication[]
  addableApps: AddableApp[]
  naisCatalogFailed: boolean
  isSubmitting: boolean
}) {
  const addModalRef = useRef<HTMLDialogElement>(null)

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <Heading level="2" size="medium">
          Applikasjoner ({linkedApps.length})
        </Heading>
        <Button
          variant="tertiary"
          size="small"
          icon={<PlusIcon aria-hidden />}
          onClick={() => addModalRef.current?.showModal()}
        >
          Legg til applikasjon
        </Button>
      </HStack>

      {linkedApps.length > 0 ? (
        <Table size="small">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Applikasjon</Table.HeaderCell>
              <Table.HeaderCell>Miljø</Table.HeaderCell>
              <Table.HeaderCell>Nais-team</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {linkedApps.map((app) => (
              <Table.Row key={app.monitored_app_id}>
                <Table.DataCell>
                  <code>{app.app_name}</code>
                </Table.DataCell>
                <Table.DataCell>{app.environment_name}</Table.DataCell>
                <Table.DataCell>{app.team_slug}</Table.DataCell>
                <Table.DataCell>
                  <Form method="post" style={{ display: 'inline' }}>
                    <input type="hidden" name="intent" value="remove_app" />
                    <input type="hidden" name="app_id" value={app.monitored_app_id} />
                    <Button variant="tertiary-neutral" size="xsmall" icon={<TrashIcon aria-hidden />} type="submit">
                      Fjern
                    </Button>
                  </Form>
                </Table.DataCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : (
        <Alert variant="info" size="small">
          Ingen applikasjoner er direkte lenket. Applikasjoner kan også arves via Nais-team.
        </Alert>
      )}

      <AddAppsDialog
        ref={addModalRef}
        addableApps={addableApps}
        naisCatalogFailed={naisCatalogFailed}
        isSubmitting={isSubmitting}
      />
    </VStack>
  )
}

import { forwardRef } from 'react'

const AddAppsDialog = forwardRef<
  HTMLDialogElement,
  { addableApps: AddableApp[]; naisCatalogFailed: boolean; isSubmitting: boolean }
>(function AddAppsDialog({ addableApps, naisCatalogFailed, isSubmitting }, ref) {
  const [search, setSearch] = useState('')

  const searchLower = search.toLowerCase()
  const filteredApps = useMemo(
    () =>
      search
        ? addableApps.filter(
            (app) =>
              app.app_name.toLowerCase().includes(searchLower) ||
              app.team_slug.toLowerCase().includes(searchLower) ||
              app.environment_name.toLowerCase().includes(searchLower),
          )
        : addableApps,
    [addableApps, search, searchLower],
  )

  const appsByNaisTeam = useMemo(() => {
    const grouped = new Map<string, AddableApp[]>()
    for (const app of filteredApps) {
      const group = grouped.get(app.team_slug) ?? []
      group.push(app)
      grouped.set(app.team_slug, group)
    }
    return grouped
  }, [filteredApps])

  const closeModal = () => {
    if (typeof ref === 'object' && ref?.current) ref.current.close()
  }

  const refValue = (app: AddableApp) =>
    app.monitored_id !== null
      ? `id:${app.monitored_id}`
      : `new:${app.team_slug}|${app.environment_name}|${app.app_name}`

  return (
    <Modal ref={ref} header={{ heading: 'Legg til applikasjoner' }} closeOnBackdropClick width="640px">
      <Modal.Body>
        <Form
          method="post"
          id="add-apps-form"
          onSubmit={() => {
            closeModal()
          }}
        >
          <input type="hidden" name="intent" value="add_apps" />
          <VStack gap="space-12">
            {naisCatalogFailed && (
              <Alert variant="error" size="small">
                Kunne ikke hente Nais-katalogen akkurat nå. Last siden på nytt om litt for å se tilgjengelige
                applikasjoner.
              </Alert>
            )}
            <BodyShort size="small" textColor="subtle">
              Lista viser Nais-applikasjoner som ikke allerede er koblet til teamet. Apper merket «Ny i overvåking»
              opprettes automatisk når du krysser dem av og lagrer.
            </BodyShort>
            <TextField
              label="Søk etter applikasjon"
              hideLabel
              placeholder="Søk etter applikasjon, team eller miljø..."
              size="small"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            <Box style={{ maxHeight: '400px', overflowY: 'auto' }} paddingInline="space-4" paddingBlock="space-4">
              {filteredApps.length === 0 ? (
                <BodyShort size="small" textColor="subtle">
                  {search
                    ? 'Ingen applikasjoner matcher søket.'
                    : naisCatalogFailed
                      ? 'Ingen applikasjoner å vise — Nais-katalogen er utilgjengelig.'
                      : addableApps.length === 0
                        ? 'Alle Nais-applikasjoner er allerede koblet til teamet.'
                        : 'Ingen applikasjoner funnet i Nais.'}
                </BodyShort>
              ) : (
                <VStack gap="space-16">
                  {[...appsByNaisTeam.entries()].map(([naisTeam, apps]) => (
                    <CheckboxGroup key={naisTeam} legend={naisTeam} size="small">
                      {apps.map((app) => (
                        <Checkbox
                          key={`${app.team_slug}|${app.environment_name}|${app.app_name}`}
                          name="app_ref"
                          value={refValue(app)}
                        >
                          <HStack gap="space-8" align="center" wrap>
                            <span>{app.app_name}</span>
                            <BodyShort as="span" size="small" textColor="subtle">
                              ({app.environment_name})
                            </BodyShort>
                            {app.monitored_id === null && (
                              <Tag size="xsmall" variant="info">
                                Ny i overvåking
                              </Tag>
                            )}
                          </HStack>
                        </Checkbox>
                      ))}
                    </CheckboxGroup>
                  ))}
                </VStack>
              )}
            </Box>
          </VStack>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button type="submit" form="add-apps-form" size="small" loading={isSubmitting}>
          Legg til valgte
        </Button>
        <Button variant="tertiary" size="small" type="button" onClick={closeModal}>
          Avbryt
        </Button>
      </Modal.Footer>
    </Modal>
  )
})
