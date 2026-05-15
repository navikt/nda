import type { Meta, StoryObj } from '@storybook/react'
import { SearchResultsPage } from '~/components/SearchResultsPage'
import type { SearchResult, SearchResultPresentation } from '~/lib/search-results'
import { mockSearchResults } from './mock-data'

const storyPresentation = (result: SearchResult): SearchResultPresentation => ({
  icon: 'search',
  label: result.type === 'deployment' ? 'Deployment' : 'Bruker',
  variant: result.type === 'deployment' ? 'info' : 'neutral',
})

const meta: Meta<typeof SearchResultsPage> = {
  title: 'Pages/Search',
  component: SearchResultsPage,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: '800px' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof SearchResultsPage>

export const Empty: Story = {
  name: 'Tomt søk',
  args: {
    query: '',
    results: [],
  },
  render: (args) => <SearchResultsPage {...args} getResultPresentation={storyPresentation} />,
}

export const WithResults: Story = {
  name: 'Med resultater',
  args: {
    query: 'john',
    results: mockSearchResults,
  },
  render: (args) => <SearchResultsPage {...args} getResultPresentation={storyPresentation} />,
}

export const NoResults: Story = {
  name: 'Ingen treff',
  args: {
    query: 'xyz123',
    results: [],
  },
  render: (args) => <SearchResultsPage {...args} getResultPresentation={storyPresentation} />,
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
        subtitle: 'pensjon-selvbetjening (prod-fss) - Jane Doe',
        url: '/team/pensjondeployer/env/prod-fss/app/pensjon-selvbetjening/deployments/3',
      },
      {
        id: 4,
        type: 'deployment',
        title: 'ghi789jkl012',
        subtitle: 'pensjon-opptjening (prod-gcp) - Bob Smith',
        url: '/team/pensjondeployer/env/prod-gcp/app/pensjon-opptjening/deployments/4',
      },
      {
        type: 'user',
        title: 'jane-doe',
        subtitle: 'Jane Doe (B234567)',
        url: '/users/jane-doe',
      },
    ],
  },
  render: (args) => <SearchResultsPage {...args} getResultPresentation={storyPresentation} />,
}
