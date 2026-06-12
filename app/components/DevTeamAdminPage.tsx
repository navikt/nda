import { PlusIcon, TrashIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  Heading,
  HStack,
  Modal,
  Select,
  Table,
  Tag,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form, Link } from 'react-router'
import { ActionAlert } from '~/components/ActionAlert'
import { AddAppsDialog, type AddableApp } from '~/components/AddAppsDialog'
import { type RoleMember, RoleMembersSection } from '~/components/RoleMembersSection'
import { type BoardPeriodType, formatBoardLabel, getPeriodsForYear } from '~/lib/board-periods'

type BoardView = {
  id: number
  period_type: string
  period_label: string
  period_start: string | Date
  period_end: string | Date
  is_active: boolean
}

type DevTeamApplicationView = {
  monitored_app_id: number
  team_slug: string
  environment_name: string
  app_name: string
}

type TeamGroupApp = {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
  is_team_app: boolean
}

type TeamGroupView = {
  id: number
  name: string
  apps: TeamGroupApp[]
}

type UngroupedTeamAppView = {
  id: number
  team_slug: string
  environment_name: string
  app_name: string
}

type DevTeamView = {
  name: string
  slug: string
  nais_team_slugs: string[]
}

type ActionResultView = {
  success?: string
  error?: string
}

interface DevTeamAdminPageProps {
  devTeam: DevTeamView
  roleMembers: RoleMember[]
  linkedApps: DevTeamApplicationView[]
  addableApps: AddableApp[]
  naisCatalogFailed: boolean
  boards: BoardView[]
  teamGroups: TeamGroupView[]
  ungroupedTeamApps: UngroupedTeamAppView[]
  canAdmin: boolean
  teamBasePath: string
  isSubmitting: boolean
  actionData?: ActionResultView
}

export function DevTeamAdminPage({
  devTeam,
  roleMembers,
  linkedApps,
  addableApps,
  naisCatalogFailed,
  boards,
  teamGroups,
  ungroupedTeamApps,
  canAdmin,
  teamBasePath,
  isSubmitting,
  actionData,
}: DevTeamAdminPageProps) {
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
      <RoleMembersSection roleMembers={roleMembers} />
      {canAdmin && <NaisTeamsSection naisTeamSlugs={devTeam.nais_team_slugs} />}
      {canAdmin && (
        <ApplicationsSection
          linkedApps={linkedApps}
          addableApps={addableApps}
          naisCatalogFailed={naisCatalogFailed}
          isSubmitting={isSubmitting}
        />
      )}
      {canAdmin && <ApplicationGroupsTeamSection teamGroups={teamGroups} ungroupedTeamApps={ungroupedTeamApps} />}
    </VStack>
  )
}

function BoardsSection({
  teamName,
  boards,
  teamBasePath,
}: {
  teamName: string
  boards: BoardView[]
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
              <option value="monthly">Måned</option>
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
  linkedApps: DevTeamApplicationView[]
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

function ApplicationGroupsTeamSection({
  teamGroups,
  ungroupedTeamApps,
}: {
  teamGroups: TeamGroupView[]
  ungroupedTeamApps: UngroupedTeamAppView[]
}) {
  const [showCreate, setShowCreate] = useState(false)
  const [selectedAppIds, setSelectedAppIds] = useState<number[]>([])

  const appEnvMap = ungroupedTeamApps.reduce<Map<string, Set<string>>>((acc, a) => {
    const envs = acc.get(a.app_name) ?? new Set()
    envs.add(a.environment_name)
    acc.set(a.app_name, envs)
    return acc
  }, new Map())
  const suggestions = [...appEnvMap.entries()]
    .filter(([, envs]) => envs.size > 1)
    .map(([name, envs]) => ({ name, envCount: envs.size }))

  function toggleApp(id: number) {
    setSelectedAppIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <VStack gap="space-16">
      <HStack justify="space-between" align="center">
        <div>
          <Heading level="2" size="medium">
            Applikasjonsgrupper ({teamGroups.length})
          </Heading>
          <BodyShort size="small" textColor="subtle">
            Grupper apper som er samme logiske app på tvers av NAIS-clustre. Verifikasjonsstatus propageres automatisk
            innad i gruppen.
          </BodyShort>
        </div>
        {!showCreate && ungroupedTeamApps.length > 0 && (
          <Button variant="tertiary" size="small" icon={<PlusIcon aria-hidden />} onClick={() => setShowCreate(true)}>
            Ny gruppe
          </Button>
        )}
      </HStack>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Box padding="space-16" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <VStack gap="space-12">
            <Heading level="3" size="xsmall">
              Foreslåtte grupper
            </Heading>
            <BodyShort size="small" textColor="subtle">
              Disse appene finnes i flere miljøer uten å være gruppert:
            </BodyShort>
            <VStack gap="space-8">
              {suggestions.map(({ name, envCount }) => (
                <HStack key={name} gap="space-12" align="center" justify="space-between">
                  <HStack gap="space-8" align="center">
                    <BodyShort size="small" weight="semibold">
                      {name}
                    </BodyShort>
                    <Tag size="xsmall" variant="info">
                      {envCount} miljøer
                    </Tag>
                  </HStack>
                  <Form method="post">
                    <input type="hidden" name="intent" value="create_from_team_suggestion" />
                    <input type="hidden" name="app_name" value={name} />
                    <Button variant="tertiary" size="xsmall" type="submit" icon={<PlusIcon aria-hidden />}>
                      Opprett gruppe
                    </Button>
                  </Form>
                </HStack>
              ))}
            </VStack>
          </VStack>
        </Box>
      )}

      {/* Create new group form */}
      {showCreate && (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post">
            <input type="hidden" name="intent" value="create_team_group" />
            <VStack gap="space-16">
              <Heading level="3" size="xsmall">
                Opprett ny gruppe
              </Heading>
              <TextField label="Gruppenavn" name="name" size="small" autoComplete="off" />
              <VStack gap="space-8">
                <BodyShort size="small" weight="semibold">
                  Velg applikasjoner å inkludere:
                </BodyShort>
                {ungroupedTeamApps.length === 0 ? (
                  <BodyShort size="small" textColor="subtle">
                    Ingen ugrupperte applikasjoner tilgjengelig.
                  </BodyShort>
                ) : (
                  <Table size="small">
                    <Table.Header>
                      <Table.Row>
                        <Table.HeaderCell />
                        <Table.HeaderCell>App</Table.HeaderCell>
                        <Table.HeaderCell>Miljø</Table.HeaderCell>
                        <Table.HeaderCell>Nais-team</Table.HeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {ungroupedTeamApps.map((app) => (
                        <Table.Row
                          key={app.id}
                          selected={selectedAppIds.includes(app.id)}
                          onClick={() => toggleApp(app.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <Table.DataCell>
                            <input
                              type="checkbox"
                              name="app_id"
                              value={app.id}
                              checked={selectedAppIds.includes(app.id)}
                              onChange={() => toggleApp(app.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Velg ${app.app_name} (${app.environment_name})`}
                            />
                          </Table.DataCell>
                          <Table.DataCell>
                            <code>{app.app_name}</code>
                          </Table.DataCell>
                          <Table.DataCell>{app.environment_name}</Table.DataCell>
                          <Table.DataCell>{app.team_slug}</Table.DataCell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                )}
              </VStack>
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Opprett gruppe
                </Button>
                <Button
                  variant="tertiary"
                  size="small"
                  type="button"
                  onClick={() => {
                    setShowCreate(false)
                    setSelectedAppIds([])
                  }}
                >
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Box>
      )}

      {/* Existing groups */}
      {teamGroups.length === 0 && !showCreate && suggestions.length === 0 && (
        <Alert variant="info" size="small">
          Ingen applikasjonsgrupper er opprettet for dette teamets applikasjoner ennå.
        </Alert>
      )}

      {teamGroups.map((group) => (
        <Box
          key={group.id}
          padding="space-20"
          borderRadius="8"
          background="raised"
          borderColor="neutral-subtle"
          borderWidth="1"
        >
          <VStack gap="space-16">
            <HStack align="center" justify="space-between">
              <HStack gap="space-12" align="center">
                <Heading level="3" size="xsmall">
                  {group.name}
                </Heading>
                <Tag size="xsmall" variant="neutral">
                  {group.apps.length} app{group.apps.length !== 1 ? 'er' : ''}
                </Tag>
              </HStack>
              <Form method="post">
                <input type="hidden" name="intent" value="delete_team_group" />
                <input type="hidden" name="group_id" value={group.id} />
                <Button variant="tertiary-neutral" size="xsmall" type="submit" icon={<TrashIcon aria-hidden />}>
                  Slett gruppe
                </Button>
              </Form>
            </HStack>

            {/* Apps in group */}
            <Table size="small">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>App</Table.HeaderCell>
                  <Table.HeaderCell>Miljø</Table.HeaderCell>
                  <Table.HeaderCell>Nais-team</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {group.apps.map((app) => (
                  <Table.Row key={app.id}>
                    <Table.DataCell>
                      <code>{app.app_name}</code>
                    </Table.DataCell>
                    <Table.DataCell>{app.environment_name}</Table.DataCell>
                    <Table.DataCell>{app.team_slug}</Table.DataCell>
                    <Table.DataCell>
                      {app.is_team_app ? (
                        <Form method="post" style={{ display: 'inline' }}>
                          <input type="hidden" name="intent" value="remove_team_app_from_group" />
                          <input type="hidden" name="app_id" value={app.id} />
                          <Button
                            variant="tertiary-neutral"
                            size="xsmall"
                            type="submit"
                            icon={<TrashIcon aria-hidden />}
                          >
                            Fjern
                          </Button>
                        </Form>
                      ) : (
                        <Tag size="xsmall" variant="info">
                          Annet team
                        </Tag>
                      )}
                    </Table.DataCell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>

            {/* Add team app to group */}
            {ungroupedTeamApps.length > 0 && (
              <Form method="post">
                <input type="hidden" name="intent" value="add_team_app_to_group" />
                <input type="hidden" name="group_id" value={group.id} />
                <HStack gap="space-12" align="end">
                  <Select label="Legg til applikasjon fra teamet" name="app_id" size="small" style={{ flex: 1 }}>
                    <option value="">Velg applikasjon...</option>
                    {ungroupedTeamApps.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.app_name} ({app.team_slug} / {app.environment_name})
                      </option>
                    ))}
                  </Select>
                  <Button variant="tertiary" size="small" type="submit" icon={<PlusIcon aria-hidden />}>
                    Legg til
                  </Button>
                </HStack>
              </Form>
            )}
          </VStack>
        </Box>
      ))}
    </VStack>
  )
}
