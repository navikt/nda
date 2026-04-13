import { BarChartIcon, ClockIcon, PlusIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Detail,
  Heading,
  HStack,
  Modal,
  Select,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form, Link, useActionData, useLoaderData, useNavigation, useRouteLoaderData } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { type Board, createBoard, getBoardsByDevTeam } from '~/db/boards.server'
import { type BoardObjectiveProgress, getBoardObjectiveProgress } from '~/db/dashboard-stats.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import {
  getAvailableAppsForDevTeam,
  getDevTeamApplications,
  getDevTeamBySlug,
  setDevTeamApplications,
} from '~/db/dev-teams.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { getSectionBySlug } from '~/db/sections.server'
import { type DevTeamMember, getDevTeamMembers } from '~/db/user-dev-team-preference.server'
import { requireUser } from '~/lib/auth.server'
import { type BoardPeriodType, getPeriodsForYear } from '~/lib/board-periods'
import { groupAppCards } from '~/lib/group-app-cards'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug'
import type { loader as layoutLoader } from './layout'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }
  const [boards, members, directApps, allApps, alertCounts, activeRepos, availableApps] = await Promise.all([
    getBoardsByDevTeam(devTeam.id),
    getDevTeamMembers(devTeam.id).catch(() => [] as DevTeamMember[]),
    getDevTeamApplications(devTeam.id),
    getAllMonitoredApplications(),
    getAllAlertCounts(),
    getAllActiveRepositories(),
    getAvailableAppsForDevTeam(devTeam.id),
  ])

  const activeBoard = boards.find((b) => b.is_active) ?? null
  const activeBoardProgress = activeBoard ? await getBoardObjectiveProgress(activeBoard.id) : []

  // Build app cards: direct links + nais team matches
  const directAppIds = new Set(directApps.map((a) => a.monitored_app_id))
  const naisTeamSlugs = devTeam.nais_team_slugs ?? []
  const teamApps = allApps.filter(
    (app) => app.is_active && (directAppIds.has(app.id) || naisTeamSlugs.includes(app.team_slug)),
  )

  const statsByApp =
    teamApps.length > 0
      ? await getAppDeploymentStatsBatch(teamApps.map((a) => ({ id: a.id, audit_start_year: a.audit_start_year })))
      : new Map()

  const appCards: AppCardData[] = groupAppCards(
    teamApps.map((app) => ({
      ...app,
      active_repo: activeRepos.get(app.id) || null,
      stats: statsByApp.get(app.id) || {
        total: 0,
        with_four_eyes: 0,
        without_four_eyes: 0,
        pending_verification: 0,
        last_deployment: null,
        last_deployment_id: null,
        four_eyes_percentage: 0,
      },
      alertCount: alertCounts.get(app.id) || 0,
    })),
  ).sort((a, b) => a.app_name.localeCompare(b.app_name, 'nb'))

  const section = await getSectionBySlug(params.sectionSlug)

  return {
    devTeam,
    boards,
    activeBoard,
    activeBoardProgress,
    members,
    appCards,
    availableApps,
    sectionSlug: params.sectionSlug,
    sectionName: section?.name ?? params.sectionSlug,
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }

  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'update_apps') {
    const appIds = formData
      .getAll('app_ids')
      .map(Number)
      .filter((n) => !Number.isNaN(n) && n > 0)
    try {
      await setDevTeamApplications(devTeam.id, appIds)
      return { success: 'Applikasjoner oppdatert.' }
    } catch (error) {
      return { error: `Kunne ikke oppdatere applikasjoner: ${error}` }
    }
  }

  if (intent === 'create') {
    const title = (formData.get('title') as string)?.trim()
    const periodType = formData.get('period_type') as BoardPeriodType
    const periodLabel = formData.get('period_label') as string
    const periodStart = formData.get('period_start') as string
    const periodEnd = formData.get('period_end') as string

    if (!title || !periodType || !periodStart || !periodEnd || !periodLabel) {
      return { error: 'Alle felt er påkrevd.' }
    }

    try {
      await createBoard({
        dev_team_id: devTeam.id,
        title,
        period_type: periodType,
        period_start: periodStart,
        period_end: periodEnd,
        period_label: periodLabel,
        created_by: user.navIdent,
      })
      return { success: true }
    } catch (error) {
      return { error: `Kunne ikke opprette tavle: ${error}` }
    }
  }

  return { error: 'Ukjent handling.' }
}

export default function DevTeamPage() {
  const { devTeam, boards, activeBoard, activeBoardProgress, members, appCards, availableApps, sectionSlug } =
    useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const layoutData = useRouteLoaderData<typeof layoutLoader>('routes/layout')
  const isAdmin = layoutData?.user?.role === 'admin'
  const [showCreate, setShowCreate] = useState(false)
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`
  const inactiveBoards = boards.filter((b) => !b.is_active)
  const addAppsRef = useRef<HTMLDialogElement>(null)

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          {devTeam.name}
        </Heading>
        <BodyShort textColor="subtle">Teamside med mål- og commitmentstavler.</BodyShort>
      </div>

      {/* Active board */}
      {activeBoard ? (
        <ActiveBoardSection board={activeBoard} progress={activeBoardProgress} teamBasePath={teamBasePath} />
      ) : (
        <Alert variant="info">Ingen aktiv tavle. Opprett en ny tavle for å komme i gang.</Alert>
      )}

      {/* Board actions */}
      {!showCreate ? (
        <HStack gap="space-8">
          <Button variant="secondary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
            Ny tavle
          </Button>
          <Button
            as={Link}
            to={`${teamBasePath}/dashboard`}
            variant="tertiary"
            size="small"
            icon={<BarChartIcon aria-hidden />}
          >
            Dashboard
          </Button>
          {inactiveBoards.length > 0 && (
            <Button
              as={Link}
              to={`${teamBasePath}/boards`}
              variant="tertiary"
              size="small"
              icon={<ClockIcon aria-hidden />}
            >
              Tidligere tavler ({inactiveBoards.length})
            </Button>
          )}
        </HStack>
      ) : (
        <CreateBoardForm onCancel={() => setShowCreate(false)} />
      )}

      {/* Members */}
      {members.length > 0 && (
        <VStack gap="space-8">
          <Heading level="2" size="small">
            Medlemmer ({members.length})
          </Heading>
          <HStack gap="space-8" wrap>
            {members.map((member) => (
              <Tag key={member.nav_ident} variant="neutral" size="small">
                {member.github_username ? (
                  <Link to={`/users/${member.github_username}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    {member.display_name || member.nav_ident}
                  </Link>
                ) : (
                  member.display_name || member.nav_ident
                )}
              </Tag>
            ))}
          </HStack>
        </VStack>
      )}

      {/* Applications */}
      <VStack gap="space-8">
        <HStack justify="space-between" align="center">
          <Heading level="2" size="small">
            Applikasjoner ({appCards.length})
          </Heading>
          {isAdmin && (
            <Button
              size="small"
              variant="tertiary"
              icon={<PlusIcon aria-hidden />}
              onClick={() => addAppsRef.current?.showModal()}
            >
              Legg til applikasjon
            </Button>
          )}
        </HStack>
        <ActionAlert data={actionData} />
        {appCards.length > 0 ? (
          <VStack gap="space-4">
            {appCards.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </VStack>
        ) : (
          <BodyShort textColor="subtle">Ingen applikasjoner er lagt til ennå.</BodyShort>
        )}
      </VStack>

      {/* Add apps dialog */}
      <AddAppsDialog
        ref={addAppsRef}
        devTeamId={devTeam.id}
        availableApps={availableApps}
        isSubmitting={navigation.state === 'submitting'}
      />
    </VStack>
  )
}

function ActiveBoardSection({
  board,
  progress,
  teamBasePath,
}: {
  board: Board
  progress: BoardObjectiveProgress[]
  teamBasePath: string
}) {
  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <VStack gap="space-16">
        <HStack justify="space-between" align="center" wrap>
          <VStack gap="space-4">
            <Heading level="2" size="medium">
              <Link to={`${teamBasePath}/${board.id}`}>{board.title}</Link>
            </Heading>
            <HStack gap="space-8">
              <Tag variant="success" size="xsmall">
                Aktiv
              </Tag>
              <Detail textColor="subtle">{board.period_label}</Detail>
            </HStack>
          </VStack>
          <Button as={Link} to={`${teamBasePath}/${board.id}`} variant="tertiary" size="small">
            Åpne tavle
          </Button>
        </HStack>

        {progress.length > 0 ? (
          <VStack gap="space-8">
            {progress.map((obj) => (
              <Box key={obj.objective_id} padding="space-12" borderRadius="4" background="neutral-soft">
                <VStack gap="space-4">
                  <HStack justify="space-between" align="center">
                    <BodyShort weight="semibold" size="small">
                      {obj.objective_title}
                    </BodyShort>
                    <Tag variant="neutral" size="xsmall">
                      {obj.total_linked_deployments} deployments
                    </Tag>
                  </HStack>
                  {obj.key_results.length > 0 && (
                    <HStack gap="space-8" wrap>
                      {obj.key_results.map((kr) => (
                        <Detail key={kr.id} textColor="subtle">
                          {kr.title}: {kr.linked_deployments}
                        </Detail>
                      ))}
                    </HStack>
                  )}
                </VStack>
              </Box>
            ))}
          </VStack>
        ) : (
          <BodyShort size="small" textColor="subtle">
            Ingen mål er opprettet for denne tavlen ennå.
          </BodyShort>
        )}
      </VStack>
    </Box>
  )
}

import { forwardRef } from 'react'

type AvailableApp = { id: number; team_slug: string; environment_name: string; app_name: string; is_linked: boolean }

const AddAppsDialog = forwardRef<
  HTMLDialogElement,
  { devTeamId: number; availableApps: AvailableApp[]; isSubmitting: boolean }
>(function AddAppsDialog({ devTeamId, availableApps, isSubmitting }, ref) {
  const appsByNaisTeam = new Map<string, AvailableApp[]>()
  for (const app of availableApps) {
    const group = appsByNaisTeam.get(app.team_slug) ?? []
    group.push(app)
    appsByNaisTeam.set(app.team_slug, group)
  }

  return (
    <Modal ref={ref} header={{ heading: 'Legg til applikasjoner' }} closeOnBackdropClick width="600px">
      <Form
        method="post"
        onSubmit={() => {
          if (typeof ref === 'object' && ref?.current) ref.current.close()
        }}
      >
        <input type="hidden" name="intent" value="update_apps" />
        <input type="hidden" name="id" value={devTeamId} />
        <Modal.Body>
          {availableApps.length === 0 ? (
            <Alert variant="info" size="small">
              Ingen overvåkede applikasjoner funnet.
            </Alert>
          ) : (
            <VStack gap="space-16">
              {[...appsByNaisTeam.entries()].map(([naisTeam, apps]) => (
                <CheckboxGroup key={naisTeam} legend={naisTeam} size="small">
                  {apps.map((app) => (
                    <Checkbox key={app.id} name="app_ids" value={String(app.id)} defaultChecked={app.is_linked}>
                      {app.app_name}{' '}
                      <BodyShort as="span" size="small" textColor="subtle">
                        ({app.environment_name})
                      </BodyShort>
                    </Checkbox>
                  ))}
                </CheckboxGroup>
              ))}
            </VStack>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" size="small" loading={isSubmitting}>
            Lagre
          </Button>
          <Button
            variant="tertiary"
            size="small"
            type="button"
            onClick={() => {
              if (typeof ref === 'object' && ref?.current) ref.current.close()
            }}
          >
            Avbryt
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
})

function CreateBoardForm({ onCancel }: { onCancel: () => void }) {
  const [periodType, setPeriodType] = useState<BoardPeriodType>('tertiary')
  const year = new Date().getFullYear()
  const periods = getPeriodsForYear(periodType, year)

  const [selectedPeriod, setSelectedPeriod] = useState(periods[0])

  return (
    <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
      <Form method="post" onSubmit={onCancel}>
        <input type="hidden" name="intent" value="create" />
        <input type="hidden" name="period_start" value={selectedPeriod?.start ?? ''} />
        <input type="hidden" name="period_end" value={selectedPeriod?.end ?? ''} />
        <input type="hidden" name="period_label" value={selectedPeriod?.label ?? ''} />
        <VStack gap="space-16">
          <Heading level="2" size="small">
            Opprett ny tavle
          </Heading>
          <HStack gap="space-16" wrap>
            <TextField label="Tittel" name="title" size="small" placeholder="f.eks. Mål T1 2026" autoComplete="off" />
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
