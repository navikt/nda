import { Alert, BodyShort, Button, Modal, VStack } from '@navikt/ds-react'
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Form } from 'react-router'
import { endOfDay } from '~/lib/date-utils'
import { GoalSelectionFields } from './GoalSelectionFields'

export type BulkLinkAvailableBoard = {
  id: number
  period_label: string
  period_start: string
  period_end: string
  dev_team_name: string
  objectives: Array<{ id: number; title: string; key_results: Array<{ id: number; title: string }> }>
}

export const BulkLinkGoalModal = forwardRef<
  HTMLDialogElement,
  {
    username: string
    period: string
    appFilter: string
    availableBoards: BulkLinkAvailableBoard[]
    isSubmitting: boolean
    hasUnlinkedDeployments: boolean
  }
>(function BulkLinkGoalModal(
  { username, period, appFilter, availableBoards, isSubmitting, hasUnlinkedDeployments },
  ref,
) {
  const internalRef = useRef<HTMLDialogElement>(null)
  useImperativeHandle(ref, () => internalRef.current as HTMLDialogElement)
  const [hasObjective, setHasObjective] = useState(false)

  if (!hasUnlinkedDeployments) {
    return (
      <Modal
        ref={internalRef}
        header={{ heading: 'Koble Dependabot-leveranser til endringsopphav' }}
        closeOnBackdropClick
      >
        <Modal.Body>
          <BodyShort>Ingen Dependabot-leveranser uten endringsopphav funnet.</BodyShort>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="small" type="button" onClick={() => internalRef.current?.close()}>
            Lukk
          </Button>
        </Modal.Footer>
      </Modal>
    )
  }

  return (
    <Modal
      ref={internalRef}
      header={{ heading: 'Koble Dependabot-leveranser til endringsopphav' }}
      closeOnBackdropClick
    >
      <Form method="post" id="bulk-link-form">
        <input type="hidden" name="intent" value="bulk_link_goal" />
        <input type="hidden" name="username" value={username} />
        <input type="hidden" name="period" value={period} />
        {appFilter && <input type="hidden" name="app_name" value={appFilter} />}
        <Modal.Body>
          <VStack gap="space-16">
            <BodyShort>
              Kobler alle Dependabot-leveranser uten endringsopphav til det valgte målet
              {period !== 'all' ? ' (innenfor valgt tidsperiode)' : ''}
              {appFilter ? ` for ${appFilter}` : ''}.
            </BodyShort>

            <GoalSelectionFields boards={availableBoards} onObjectiveChange={(id) => setHasObjective(!!id)} />
          </VStack>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" form="bulk-link-form" size="small" loading={isSubmitting} disabled={!hasObjective}>
            Koble alle
          </Button>
          <Button variant="secondary" size="small" type="button" onClick={() => internalRef.current?.close()}>
            Avbryt
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
})

export const SelectLinkGoalModal = forwardRef<
  HTMLDialogElement,
  {
    selectedIds: number[]
    selectedDates: (string | Date)[]
    availableBoards: BulkLinkAvailableBoard[]
    isSubmitting: boolean
  }
>(function SelectLinkGoalModal({ selectedIds, selectedDates, availableBoards, isSubmitting }, ref) {
  const internalRef = useRef<HTMLDialogElement>(null)
  useImperativeHandle(ref, () => internalRef.current as HTMLDialogElement)
  const [hasObjective, setHasObjective] = useState(false)

  const relevantBoards = useMemo(() => {
    if (selectedDates.length === 0) return availableBoards
    return availableBoards.filter((board) => {
      const boardStart = new Date(board.period_start)
      const boardEnd = endOfDay(new Date(board.period_end))
      return selectedDates.some((date) => {
        const d = new Date(date)
        return d >= boardStart && d <= boardEnd
      })
    })
  }, [availableBoards, selectedDates])

  const spansMultiplePeriods = useMemo(() => {
    if (selectedDates.length <= 1 || relevantBoards.length === 0) return false
    return !relevantBoards.some((board) => {
      const boardStart = new Date(board.period_start)
      const boardEnd = endOfDay(new Date(board.period_end))
      return selectedDates.every((date) => {
        const d = new Date(date)
        return d >= boardStart && d <= boardEnd
      })
    })
  }, [relevantBoards, selectedDates])

  return (
    <Modal
      ref={internalRef}
      header={{ heading: `Koble ${selectedIds.length} leveranser til endringsopphav` }}
      closeOnBackdropClick
    >
      <Form method="post" id="select-link-form">
        <input type="hidden" name="intent" value="link_selected_goal" />
        {selectedIds.map((id) => (
          <input key={id} type="hidden" name="deployment_ids" value={String(id)} />
        ))}
        <Modal.Body>
          <VStack gap="space-16">
            <BodyShort>Kobler de {selectedIds.length} markerte leveransene til det valgte målet.</BodyShort>

            {relevantBoards.length === 0 ? (
              <Alert variant="warning" size="small">
                Ingen måltavler dekker perioden til de valgte leveransene.
              </Alert>
            ) : (
              <>
                {spansMultiplePeriods && (
                  <Alert variant="warning" size="small">
                    De valgte leveransene spenner over flere måltavleperioder. Velg leveranser innenfor samme periode
                    for å sikre riktig kobling.
                  </Alert>
                )}

                <GoalSelectionFields boards={relevantBoards} onObjectiveChange={(id) => setHasObjective(!!id)} />
              </>
            )}
          </VStack>
        </Modal.Body>
        <Modal.Footer>
          <Button type="submit" form="select-link-form" size="small" loading={isSubmitting} disabled={!hasObjective}>
            Koble {selectedIds.length} leveranser
          </Button>
          <Button variant="secondary" size="small" type="button" onClick={() => internalRef.current?.close()}>
            Avbryt
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
})
