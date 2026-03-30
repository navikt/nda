import { BarChartIcon, PlusIcon } from '@navikt/aksel-icons'
import { Alert, BodyShort, Box, Button, Heading, HStack, Select, Table, Tag, TextField, VStack } from '@navikt/ds-react'
import { useState } from 'react'
import { Form, Link, useLoaderData } from 'react-router'
import { AppCard, type AppCardData } from '~/components/AppCard'
import { getAllActiveRepositories } from '~/db/application-repositories.server'
import { type Board, createBoard, getBoardsByDevTeam } from '~/db/boards.server'
import { getAppDeploymentStatsBatch } from '~/db/deployments.server'
import { getDevTeamApplications, getDevTeamBySlug } from '~/db/dev-teams.server'
import { getAllAlertCounts, getAllMonitoredApplications } from '~/db/monitored-applications.server'
import { type DevTeamMember, getDevTeamMembers } from '~/db/user-dev-team-preference.server'
import { requireUser } from '~/lib/auth.server'
import { type BoardPeriodType, getCurrentPeriod, getPeriodsForYear } from '~/lib/board-periods'
import type { Route } from './+types/sections.$sectionSlug.teams.$devTeamSlug'

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.devTeam?.name ?? 'Utviklingsteam'}` }]
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }
  const [boards, members, directApps, allApps, alertCounts, activeRepos] = await Promise.all([
    getBoardsByDevTeam(devTeam.id),
    getDevTeamMembers(devTeam.id).catch(() => [] as DevTeamMember[]),
    getDevTeamApplications(devTeam.id),
    getAllMonitoredApplications(),
    getAllAlertCounts(),
    getAllActiveRepositories(),
  ])

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

  const appCards: AppCardData[] = teamApps
    .map((app) => ({
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
    }))
    .sort((a, b) => a.app_name.localeCompare(b.app_name, 'nb'))

  const currentTertial = getCurrentPeriod('tertiary')
  const currentQuarter = getCurrentPeriod('quarterly')
  return { devTeam, boards, members, appCards, currentTertial, currentQuarter, sectionSlug: params.sectionSlug }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request)
  const devTeam = await getDevTeamBySlug(params.devTeamSlug)
  if (!devTeam) {
    throw new Response('Utviklingsteam ikke funnet', { status: 404 })
  }

  const formData = await request.formData()
  const intent = formData.get('intent') as string

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
  const { devTeam, boards, members, appCards, sectionSlug } = useLoaderData<typeof loader>()
  const [showCreate, setShowCreate] = useState(false)
  const teamBasePath = `/sections/${sectionSlug}/teams/${devTeam.slug}`

  return (
    <VStack gap="space-24">
      <div>
        <Heading level="1" size="large" spacing>
          {devTeam.name}
        </Heading>
        <BodyShort textColor="subtle">Teamside med mål- og commitmentstavler.</BodyShort>
      </div>

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
      {appCards.length > 0 && (
        <VStack gap="space-8">
          <Heading level="2" size="small">
            Applikasjoner ({appCards.length})
          </Heading>
          <VStack gap="space-4">
            {appCards.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </VStack>
        </VStack>
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
        </HStack>
      ) : (
        <CreateBoardForm onCancel={() => setShowCreate(false)} />
      )}

      {boards.length === 0 ? (
        <Alert variant="info">Ingen tavler er opprettet for dette utviklingsteamet.</Alert>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Tavle</Table.HeaderCell>
              <Table.HeaderCell>Periode</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {boards.map((board) => (
              <BoardRow key={board.id} board={board} teamBasePath={teamBasePath} />
            ))}
          </Table.Body>
        </Table>
      )}
    </VStack>
  )
}

function BoardRow({ board, teamBasePath }: { board: Board; teamBasePath: string }) {
  return (
    <Table.Row>
      <Table.DataCell>
        <Link to={`${teamBasePath}/${board.id}`}>{board.title}</Link>
      </Table.DataCell>
      <Table.DataCell>{board.period_label}</Table.DataCell>
      <Table.DataCell>
        <Tag variant="neutral" size="small">
          {board.period_type === 'tertiary' ? 'Tertial' : 'Kvartal'}
        </Tag>
      </Table.DataCell>
      <Table.DataCell>
        <Tag variant={board.is_active ? 'success' : 'neutral'} size="small">
          {board.is_active ? 'Aktiv' : 'Avsluttet'}
        </Tag>
      </Table.DataCell>
      <Table.DataCell>
        <Button as={Link} to={`${teamBasePath}/${board.id}`} variant="tertiary" size="xsmall">
          Vis
        </Button>
      </Table.DataCell>
    </Table.Row>
  )
}

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
