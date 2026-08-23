import type { Meta, StoryObj } from '@storybook/react'
import { SearchPage } from '~/components/SearchPage'
import { mockSearchResults } from './mock-data'

const meta: Meta<typeof SearchPage> = {
  title: 'Pages/Search',
  component: SearchPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof SearchPage>

export const Empty: Story = {
  name: 'Tomt søk',
  args: {
    query: '',
    results: [],
  },
}

export const WithResults: Story = {
  name: 'Med resultater',
  args: {
    query: 'john',
    results: mockSearchResults,
  },
}

export const NoResults: Story = {
  name: 'Ingen treff',
  args: {
    query: 'xyz123',
    results: [],
  },
}

export const ManyResults: Story = {
  name: 'Mange resultater',
  args: {
    query: 'pensjon',
    results: [
      ...mockSearchResults,
      {
        id: 3,
        type: 'deployment',
        title: 'def456ghi789',
        subtitle: 'pensjon-selvbetjening (prod-fss) - Stille Skog',
        url: '/team/pensjondeployer/env/prod-fss/app/pensjon-selvbetjening/deployments/3',
      },
      {
        id: 4,
        type: 'group',
        title: 'Pensjon rapportgruppe',
        subtitle: 'Slack-gruppe for pensjon-rapportering',
        url: '/groups/pensjon-rapportgruppe',
      },
      {
        id: 5,
        type: 'dev_team',
        title: 'Pensjon kjerneteam',
        subtitle: 'Utviklerteam for pensjon-kjerne',
        url: '/dev-teams/pensjon-kjerneteam',
      },
      {
        id: 6,
        type: 'team',
        title: 'pensjondeployer',
        subtitle: 'Nais-team for pensjon',
        url: '/team/pensjondeployer',
      },
      {
        id: 7,
        type: 'app',
        title: 'pensjon-opptjening',
        subtitle: 'App i prod-gcp',
        url: '/team/pensjondeployer/env/prod-gcp/app/pensjon-opptjening',
      },
      {
        type: 'user',
        title: 'jane-doe',
        subtitle: 'Stille Skog (Z990009)',
        url: '/users/jane-doe',
      },
    ],
  },
}
