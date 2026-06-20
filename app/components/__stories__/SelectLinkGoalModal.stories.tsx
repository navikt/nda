import type { Meta, StoryObj } from '@storybook/react'
import { useRef } from 'react'
import { type BulkLinkAvailableBoard, SelectLinkGoalModal } from '../BulkLinkGoalModals'

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

const meta: Meta<typeof SelectLinkGoalModal> = {
  title: 'Components/SelectLinkGoalModal',
  component: SelectLinkGoalModal,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof SelectLinkGoalModal>

export const Default: Story = {
  name: 'Koble utvalgte leveranser',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <SelectLinkGoalModal
          ref={ref}
          selectedIds={[101, 102, 103]}
          selectedDates={['2026-02-15', '2026-02-20', '2026-03-01']}
          availableBoards={mockBoards}
          isSubmitting={false}
        />
      )}
    </AutoOpenModal>
  ),
}

export const EnLeveranse: Story = {
  name: 'Én leveranse valgt',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <SelectLinkGoalModal
          ref={ref}
          selectedIds={[42]}
          selectedDates={['2026-03-10']}
          availableBoards={mockBoards}
          isSubmitting={false}
        />
      )}
    </AutoOpenModal>
  ),
}

export const SpannerFlerePerioder: Story = {
  name: 'Spenner over flere perioder (advarsel)',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <SelectLinkGoalModal
          ref={ref}
          selectedIds={[101, 102, 103, 104]}
          selectedDates={['2026-03-15', '2026-04-20', '2026-05-10', '2026-06-01']}
          availableBoards={mockBoards}
          isSubmitting={false}
        />
      )}
    </AutoOpenModal>
  ),
}

export const IngenRelevanteTavler: Story = {
  name: 'Ingen måltavler dekker perioden',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <SelectLinkGoalModal
          ref={ref}
          selectedIds={[201, 202]}
          selectedDates={['2025-01-10', '2025-02-15']}
          availableBoards={mockBoards}
          isSubmitting={false}
        />
      )}
    </AutoOpenModal>
  ),
}

export const UnderInnsending: Story = {
  name: 'Under innsending',
  render: () => (
    <AutoOpenModal>
      {(ref) => (
        <SelectLinkGoalModal
          ref={ref}
          selectedIds={[101, 102]}
          selectedDates={['2026-02-15', '2026-03-01']}
          availableBoards={mockBoards}
          isSubmitting={true}
        />
      )}
    </AutoOpenModal>
  ),
}
