import type { Meta, StoryObj } from '@storybook/react'
import { useRef } from 'react'
import { type BulkLinkAvailableBoard, BulkLinkGoalModal } from '../BulkLinkGoalModals'

const mockBoards: BulkLinkAvailableBoard[] = [
  {
    id: 1,
    period_label: 'T1 2026',
    period_start: '2026-01-01',
    period_end: '2026-04-30',
    dev_team_name: 'Team Pensjon',
    objectives: [
      {
        id: 10,
        title: 'Forbedre brukeropplevelse for selvbetjening',
        key_results: [
          { id: 100, title: 'Øke andel digitale søknader til 80%' },
          { id: 101, title: 'Redusere henvendelser til kontaktsenter med 20%' },
        ],
      },
      {
        id: 11,
        title: 'Modernisere teknisk plattform',
        key_results: [
          { id: 110, title: 'Migrere 3 applikasjoner til Nais' },
          { id: 111, title: 'Redusere teknisk gjeld med 30%' },
        ],
      },
    ],
  },
  {
    id: 2,
    period_label: 'T2 2026',
    period_start: '2026-05-01',
    period_end: '2026-08-31',
    dev_team_name: 'Team Pensjon',
    objectives: [
      {
        id: 20,
        title: 'Automatisere behandling av vedtak',
        key_results: [{ id: 200, title: 'Automatiseringsgrad på 60%' }],
      },
    ],
  },
]

function AutoOpenModal({
  children,
}: {
  children: (ref: React.RefObject<HTMLDialogElement | null>) => React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()}>
        Åpne modal
      </button>
      {children(ref)}
    </>
  )
}

const bulkMeta: Meta<typeof BulkLinkGoalModal> = {
  title: 'Components/BulkLinkGoalModal',
  component: BulkLinkGoalModal,
  parameters: { layout: 'centered' },
}

export default bulkMeta
type BulkStory = StoryObj<typeof BulkLinkGoalModal>

export const Default: BulkStory = {
  name: 'Koble Dependabot-leveranser',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <BulkLinkGoalModal
          ref={ref}
          username="pcmoen"
          period="T1 2026"
          appFilter=""
          availableBoards={mockBoards}
          isSubmitting={false}
          hasUnlinkedDeployments={true}
        />
      )}
    </AutoOpenModal>
  ),
}

export const MedAppFilter: BulkStory = {
  name: 'Med app-filter',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <BulkLinkGoalModal
          ref={ref}
          username="pcmoen"
          period="T1 2026"
          appFilter="pensjon-selvbetjening"
          availableBoards={mockBoards}
          isSubmitting={false}
          hasUnlinkedDeployments={true}
        />
      )}
    </AutoOpenModal>
  ),
}

export const Submitting: BulkStory = {
  name: 'Under innsending',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <BulkLinkGoalModal
          ref={ref}
          username="pcmoen"
          period="all"
          appFilter=""
          availableBoards={mockBoards}
          isSubmitting={true}
          hasUnlinkedDeployments={true}
        />
      )}
    </AutoOpenModal>
  ),
}

export const IngenLeveranser: BulkStory = {
  name: 'Ingen Dependabot-leveranser',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <BulkLinkGoalModal
          ref={ref}
          username="pcmoen"
          period="T1 2026"
          appFilter=""
          availableBoards={mockBoards}
          isSubmitting={false}
          hasUnlinkedDeployments={false}
        />
      )}
    </AutoOpenModal>
  ),
}
