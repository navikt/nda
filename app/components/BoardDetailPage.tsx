import { PencilIcon, PlusIcon } from '@navikt/aksel-icons'
import {
  Alert,
  BodyShort,
  Box,
  Button,
  DatePicker,
  Detail,
  Heading,
  HStack,
  ReadMore,
  Tag,
  TextField,
  useDatepicker,
  VStack,
} from '@navikt/ds-react'
import { useState } from 'react'
import { Form, useSubmit } from 'react-router'
import { ObjectiveCard } from '~/components/BoardObjectiveCard'
import type { ObjectiveWithKeyResults } from '~/db/boards.server'
import type { BoardObjectiveProgress } from '~/db/dashboard-stats.server'
import { formatBoardLabel, toDateInputValue } from '~/lib/board-periods'

interface BoardDetailProps {
  devTeam: { name: string }
  board: {
    period_type: 'tertiary' | 'quarterly'
    period_start: string
    period_end: string
    period_label: string
    is_active: boolean
    objectives: ObjectiveWithKeyResults[]
  }
  objectiveProgress: BoardObjectiveProgress[]
  actionResult?: {
    error?: string
    success?: boolean
    intent?: string
    id?: number | null
  }
}

export function BoardDetailPage({ devTeam, board, objectiveProgress, actionResult }: BoardDetailProps) {
  const [showAddObjective, setShowAddObjective] = useState(false)
  const [editingDates, setEditingDates] = useState(false)

  const periodStartDate = toDateInputValue(board.period_start)
  const periodEndDate = toDateInputValue(board.period_end)

  const progressByObjective = new Map(objectiveProgress.map((p) => [p.objective_id, p]))

  return (
    <VStack gap="space-24">
      {actionResult?.error && <Alert variant="error">{actionResult.error}</Alert>}
      <div>
        <Heading level="1" size="large" spacing>
          {formatBoardLabel({ teamName: devTeam.name, periodLabel: board.period_label })}
        </Heading>
        <HStack gap="space-8" align="center">
          <Tag variant="neutral" size="small">
            {board.period_type === 'tertiary' ? 'Tertial' : 'Kvartal'}
          </Tag>
          <Tag variant={board.is_active ? 'success' : 'neutral'} size="small">
            {board.is_active ? 'Aktiv' : 'Avsluttet'}
          </Tag>
          {!editingDates ? (
            <>
              <Detail textColor="subtle">
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
              </Detail>
              <Button
                variant="tertiary"
                size="xsmall"
                icon={<PencilIcon aria-hidden />}
                onClick={() => setEditingDates(true)}
                aria-label="Endre periodestart og -slutt"
              />
            </>
          ) : (
            <EditDatesForm
              periodStart={periodStartDate}
              periodEnd={periodEndDate}
              onCancel={() => setEditingDates(false)}
            />
          )}
        </HStack>
      </div>

      <ReadMore header="Hvordan kobles deployments til mål?">
        <VStack gap="space-8">
          <BodyShort>Deployments kan kobles til mål og nøkkelresultater automatisk eller manuelt.</BodyShort>
          <BodyShort weight="semibold">Kode-ord i commit-meldinger og PR-tittel (automatisk)</BodyShort>
          <BodyShort>
            Hvert mål eller nøkkelresultat kan ha ett eller flere kode-ord. Når en deployment inneholder et kode-ord i
            PR-tittelen eller i en commit-melding, kobles den automatisk til det tilhørende målet.
          </BodyShort>
          <BodyShort weight="semibold">Kode-ord i branch-navn (automatisk)</BodyShort>
          <BodyShort>
            Kode-ord matches også mot branch-navnet på PR-en. For eksempel vil branchene «feature/pen-123-ny-forside»
            eller «pen-123/ny-forside» begge matche kode-ordet «pen-123».
          </BodyShort>
          <BodyShort weight="semibold">Tips for gode kode-ord</BodyShort>
          <BodyShort>
            Matching er uavhengig av store og små bokstaver — kode-ordet «pen-123» vil matche både «PEN-123» og
            «pen-123». Hvis samme kode-ord brukes på flere tavler for teamet, er det alltid den nyeste tavlen (den med
            siste startdato) som får koblingen. Det anbefales å bruke et team-spesifikt prefiks, for eksempel «pen-» for
            Team Pensjon. Dette gjør at kode-ordene fungerer godt også for utviklere som er tilknyttet flere
            utviklerteam.
          </BodyShort>
          <BodyShort weight="semibold">Dependabot-mål (automatisk)</BodyShort>
          <BodyShort>
            Tavlen kan ha ett Dependabot-mål. Alle deployments som kommer fra Dependabot kobles da automatisk til dette
            målet.
          </BodyShort>
          <BodyShort>
            Det er kun mulig å ha ett Dependabot-mål per tavle. For å flytte det, velg «Sett som Dependabot-mål» på et
            annet mål eller nøkkelresultat — det forrige valget fjernes automatisk.
          </BodyShort>
          <BodyShort>
            Vi anbefaler å opprette et eget nøkkelresultat for Dependabot-leveranser under et mål som «Nødvendig
            forvaltning» eller «BAU». Da skilles Dependabot-leveranser tydelig fra annen utvikling i tavlen.
          </BodyShort>
          <BodyShort weight="semibold">Manuell kobling</BodyShort>
          <BodyShort>
            Du kan også koble en deployment manuelt fra deployment-detaljsiden. Der velger du hvilket mål eller
            nøkkelresultat deploymenten hører til. Dette er nyttig for deployments som ikke fanges opp av kode-ord eller
            Dependabot-regler.
          </BodyShort>
        </VStack>
      </ReadMore>

      {board.objectives.length === 0 && !showAddObjective && (
        <Alert variant="info">Ingen mål er lagt til ennå. Legg til det første målet for denne tavlen.</Alert>
      )}

      {board.objectives.map((objective) => (
        <ObjectiveCard
          key={objective.id}
          objective={objective}
          progress={progressByObjective.get(objective.id)}
          actionResult={actionResult}
        />
      ))}

      {!showAddObjective ? (
        <HStack>
          <Button
            variant="secondary"
            size="small"
            icon={<PlusIcon aria-hidden />}
            onClick={() => setShowAddObjective(true)}
          >
            Legg til mål
          </Button>
        </HStack>
      ) : (
        <Box padding="space-24" borderRadius="8" background="raised" borderColor="neutral-subtle" borderWidth="1">
          <Form method="post" onSubmit={() => setShowAddObjective(false)}>
            <input type="hidden" name="intent" value="add-objective" />
            <VStack gap="space-16">
              <Heading level="2" size="small">
                Nytt mål (Objective)
              </Heading>
              <TextField label="Tittel" name="title" size="small" autoComplete="off" />
              <TextField label="Beskrivelse (valgfritt)" name="description" size="small" autoComplete="off" />
              <HStack gap="space-8">
                <Button type="submit" size="small">
                  Legg til
                </Button>
                <Button variant="tertiary" size="small" onClick={() => setShowAddObjective(false)}>
                  Avbryt
                </Button>
              </HStack>
            </VStack>
          </Form>
        </Box>
      )}
    </VStack>
  )
}

function EditDatesForm({
  periodStart,
  periodEnd,
  onCancel,
}: {
  periodStart: string
  periodEnd: string
  onCancel: () => void
}) {
  const [start, setStart] = useState(periodStart)
  const [end, setEnd] = useState(periodEnd)
  const submit = useSubmit()

  const startDatepicker = useDatepicker({
    defaultSelected: new Date(`${periodStart}T12:00:00`),
    onDateChange: (date) => {
      if (date) {
        setStart(toDateInputValue(date))
      }
    },
  })

  const endDatepicker = useDatepicker({
    defaultSelected: new Date(`${periodEnd}T12:00:00`),
    onDateChange: (date) => {
      if (date) {
        setEnd(toDateInputValue(date))
      }
    },
  })

  return (
    <Form
      method="post"
      onSubmit={(e) => {
        e.preventDefault()
        submit(e.currentTarget)
        onCancel()
      }}
    >
      <input type="hidden" name="intent" value="update-dates" />
      <input type="hidden" name="period_start" value={start} />
      <input type="hidden" name="period_end" value={end} />
      <HStack gap="space-8" align="end">
        <DatePicker {...startDatepicker.datepickerProps}>
          <DatePicker.Input {...startDatepicker.inputProps} label="Fra" size="small" />
        </DatePicker>
        <DatePicker {...endDatepicker.datepickerProps}>
          <DatePicker.Input {...endDatepicker.inputProps} label="Til" size="small" />
        </DatePicker>
        <Button type="submit" size="small">
          Lagre
        </Button>
        <Button variant="tertiary" size="small" onClick={onCancel}>
          Avbryt
        </Button>
      </HStack>
    </Form>
  )
}
