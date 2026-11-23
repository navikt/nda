import type { Meta, StoryObj } from '@storybook/react'
import { TeamBoardsPage } from '~/components/TeamBoardsPage'

const meta = {
  title: 'Routes/Team/Alle tavler',
  component: TeamBoardsPage,
  args: {
    devTeam: { name: 'Supplerende stønad', slug: 'supplerende-stonad' },
    sectionSlug: 'pensjon',
    boards: [
      {
        id: 3,
        period_label: 'T3 2026',
        period_type: 'tertiary',
        period_start: '2026-09-01',
        period_end: '2026-12-31',
        is_active: true,
      },
      {
        id: 2,
        period_label: 'T2 2026',
        period_type: 'tertiary',
        period_start: '2026-05-01',
        period_end: '2026-08-31',
        is_active: true,
      },
      {
        id: 1,
        period_label: 'T1 2025',
        period_type: 'tertiary',
        period_start: '2025-01-01',
        period_end: '2025-04-30',
        is_active: false,
      },
    ],
  },
} satisfies Meta<typeof TeamBoardsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = {
  args: { boards: [] },
}
